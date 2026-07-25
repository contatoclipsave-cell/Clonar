---
name: lovable-security
description: >
  Segurança em profundidade para projetos Lovable SaaS: hardening de autenticação, proteção de rotas,
  HMAC e sistemas de licenciamento, rate limiting, auditoria de segurança, CORS, secrets management e
  proteção contra vetores de ataque comuns. Use esta skill para: implementar ou revisar políticas de
  acesso, criar sistemas de licença ou assinatura com verificação de integridade, hardening de Edge
  Functions, configurar auditoria de ações sensíveis, validar que nenhum dado sensível está exposto,
  e fazer security review antes de qualquer deploy de produção. Complementa lovable-data (que escreve
  o SQL) definindo QUAIS proteções são necessárias e verificando que estão corretas.
---

# Lovable Security — Defesa em Profundidade

**Responsabilidade exclusiva:** Definir *quais* proteções são necessárias, implementar mecanismos
de segurança avançados (HMAC, rate limiting, auditoria), e verificar que as outras skills aplicaram
segurança corretamente. Não escreve UI, não define schema básico (→ lovable-data).

---

## Princípios do Framework

```
1. Never Trust the Client   — tudo validado no servidor
2. Least Privilege          — cada componente acessa só o necessário
3. Defense in Depth         — múltiplas camadas independentes
4. Fail Secure              — na dúvida, negar
5. Audit Everything         — operações sensíveis sempre logadas
6. Secrets Never in Code    — apenas em env vars ou Vault
```

---

## Camadas de Segurança do Stack

```
┌─────────────────────────────────────────────────────────┐
│  CLIENTE (Browser)                                       │
│  • Rotas protegidas com ProtectedRoute                  │
│  • Dados sensíveis nunca em localStorage                │
│  • CSP headers via Supabase/servidor                    │
├─────────────────────────────────────────────────────────┤
│  EDGE FUNCTIONS (Deno)                                   │
│  • JWT validation em toda função                        │
│  • Input validation com Zod                             │
│  • Rate limiting por IP/usuário                         │
│  • CORS restrito ao domínio da app                      │
├─────────────────────────────────────────────────────────┤
│  POSTGRESQL (Supabase)                                   │
│  • RLS em todas as tabelas                              │
│  • SECURITY DEFINER em RPCs sensíveis                   │
│  • search_path fixo nas funções                         │
│  • Secrets no Vault, não em tabelas                     │
└─────────────────────────────────────────────────────────┘
```

---

## Proteção de Rotas no Cliente

```typescript
// ProtectedRoute: base de toda proteção de rota
const ProtectedRoute = ({ requiredRole }: { requiredRole?: string }) => {
  const { user, profile, isLoading } = useAuth();

  if (isLoading) return <FullPageSpinner />;
  if (!user) return <Navigate to="/auth" replace />;
  if (requiredRole && profile?.role !== requiredRole) {
    return <Navigate to="/unauthorized" replace />;
  }
  return <Outlet />;
};

// Uso:
<Route element={<ProtectedRoute />}>           {/* qualquer autenticado */}
  <Route path="/dashboard" element={...} />
</Route>
<Route element={<ProtectedRoute requiredRole="admin" />}>
  <Route path="/admin" element={...} />
</Route>
```

---

## Rate Limiting em Edge Functions

```typescript
// Rate limiting usando Supabase como armazenamento
const checkRateLimit = async (
  adminClient: SupabaseClient,
  key: string,           // ex: `rl:activate:${ip}` ou `rl:user:${userId}`
  maxRequests: number,
  windowSeconds: number
): Promise<{ allowed: boolean; remaining: number }> => {
  const now = Math.floor(Date.now() / 1000);
  const windowStart = now - windowSeconds;

  const { data, error } = await adminClient.rpc('check_rate_limit', {
    p_key: key,
    p_max_requests: maxRequests,
    p_window_start: windowStart,
  });

  if (error) return { allowed: true, remaining: maxRequests }; // fail open em rate limit

  return { allowed: data.allowed, remaining: data.remaining };
};
```

```sql
-- RPC de rate limiting (criar uma vez)
CREATE TABLE IF NOT EXISTS public.rate_limit_counters (
  key        TEXT        NOT NULL,
  count      INTEGER     NOT NULL DEFAULT 1,
  window_start BIGINT   NOT NULL,
  PRIMARY KEY (key, window_start)
);

CREATE OR REPLACE FUNCTION public.check_rate_limit(
  p_key TEXT, p_max_requests INTEGER, p_window_start BIGINT
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_count INTEGER;
BEGIN
  -- Limpar janelas antigas
  DELETE FROM public.rate_limit_counters
  WHERE key = p_key AND window_start < p_window_start;

  -- Upsert do contador
  INSERT INTO public.rate_limit_counters (key, count, window_start)
  VALUES (p_key, 1, p_window_start)
  ON CONFLICT (key, window_start)
  DO UPDATE SET count = rate_limit_counters.count + 1
  RETURNING count INTO v_count;

  RETURN jsonb_build_object(
    'allowed',    v_count <= p_max_requests,
    'remaining',  GREATEST(0, p_max_requests - v_count),
    'count',      v_count
  );
END; $$;
```

---

## Sistema de Licenciamento com HMAC

Padrão para qualquer produto que vende acesso (extensões, SaaS com trial, planos).

### Schema do Sistema de Licenças

```sql
-- Licenças (o produto vendido)
CREATE TABLE public.licenses (
  id          UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  key         TEXT    NOT NULL UNIQUE,
  user_id     UUID    REFERENCES auth.users(id),
  plan        TEXT    NOT NULL DEFAULT 'free'
                CHECK (plan IN ('free', 'starter', 'pro', 'enterprise')),
  status      TEXT    NOT NULL DEFAULT 'active'
                CHECK (status IN ('active', 'suspended', 'expired', 'cancelled')),
  max_devices INTEGER NOT NULL DEFAULT 1,
  expires_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  metadata    JSONB NOT NULL DEFAULT '{}'
);

-- Dispositivos autorizados
CREATE TABLE public.license_devices (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  license_id         UUID NOT NULL REFERENCES public.licenses(id) ON DELETE CASCADE,
  device_fingerprint TEXT NOT NULL,
  device_name        TEXT,
  activated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  is_active          BOOLEAN NOT NULL DEFAULT true,
  UNIQUE (license_id, device_fingerprint)
);

ALTER TABLE public.licenses        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.license_devices ENABLE ROW LEVEL SECURITY;

-- Licenças: usuário vê as suas
CREATE POLICY "licenses:select:own" ON public.licenses FOR SELECT
  USING (auth.uid() = user_id);

-- Devices: acesso somente via RPC (sem leitura direta)
CREATE POLICY "devices:deny:all" ON public.license_devices FOR ALL USING (false);
```

### RPC de Ativação com HMAC + Anti-Replay

```sql
CREATE OR REPLACE FUNCTION public.activate_license_device(
  p_license_key      TEXT,
  p_device_fp        TEXT,
  p_device_name      TEXT,
  p_hmac_sig         TEXT,  -- SHA-256 hex de "key:fp:timestamp"
  p_timestamp        BIGINT
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_lic    public.licenses%ROWTYPE;
  v_count  INTEGER;
  v_secret TEXT;
  v_expected TEXT;
BEGIN
  -- 1. Anti-replay: janela de 5 minutos
  IF ABS(EXTRACT(EPOCH FROM now()) - p_timestamp) > 300 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'request_expired');
  END IF;

  -- 2. Recuperar secret do Vault
  SELECT decrypted_secret INTO v_secret
  FROM vault.decrypted_secrets WHERE name = 'hmac_license_secret';

  IF v_secret IS NULL THEN
    RAISE EXCEPTION 'HMAC secret not configured';
  END IF;

  -- 3. Verificar assinatura
  v_expected := encode(
    hmac(p_license_key || ':' || p_device_fp || ':' || p_timestamp::TEXT, v_secret, 'sha256'),
    'hex'
  );

  IF v_expected <> p_hmac_sig THEN
    INSERT INTO public.security_events (event_type, payload)
    VALUES ('invalid_hmac', jsonb_build_object('key_prefix', left(p_license_key, 8)));
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_signature');
  END IF;

  -- 4. Validar licença
  SELECT * INTO v_lic FROM public.licenses
  WHERE key = p_license_key AND status = 'active';

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'license_invalid');
  END IF;

  IF v_lic.expires_at IS NOT NULL AND v_lic.expires_at < now() THEN
    UPDATE public.licenses SET status = 'expired' WHERE id = v_lic.id;
    RETURN jsonb_build_object('ok', false, 'error', 'license_expired');
  END IF;

  -- 5. Checar limite de dispositivos
  SELECT COUNT(*) INTO v_count FROM public.license_devices
  WHERE license_id = v_lic.id AND is_active = true
    AND device_fingerprint <> p_device_fp; -- excluir reativação do mesmo device

  IF v_count >= v_lic.max_devices THEN
    RETURN jsonb_build_object('ok', false, 'error', 'device_limit_reached');
  END IF;

  -- 6. Ativar/reativar dispositivo
  INSERT INTO public.license_devices (license_id, device_fingerprint, device_name)
  VALUES (v_lic.id, p_device_fp, p_device_name)
  ON CONFLICT (license_id, device_fingerprint)
  DO UPDATE SET is_active = true, last_seen_at = now(), device_name = EXCLUDED.device_name;

  INSERT INTO public.security_events (event_type, user_id, payload)
  VALUES ('license_activated', v_lic.user_id,
    jsonb_build_object('plan', v_lic.plan, 'device', p_device_name));

  RETURN jsonb_build_object(
    'ok', true, 'plan', v_lic.plan,
    'expires_at', v_lic.expires_at, 'license_id', v_lic.id
  );
END; $$;
```

### Heartbeat de Licença

```sql
CREATE OR REPLACE FUNCTION public.heartbeat_license(
  p_license_key TEXT, p_device_fp TEXT
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE v_lic public.licenses%ROWTYPE;
BEGIN
  SELECT l.* INTO v_lic
  FROM public.licenses l
  JOIN public.license_devices d ON d.license_id = l.id
  WHERE l.key = p_license_key
    AND d.device_fingerprint = p_device_fp
    AND d.is_active = true AND l.status = 'active';

  IF NOT FOUND THEN
    RETURN jsonb_build_object('valid', false, 'reason', 'not_found');
  END IF;

  IF v_lic.expires_at IS NOT NULL AND v_lic.expires_at < now() THEN
    RETURN jsonb_build_object('valid', false, 'reason', 'expired');
  END IF;

  UPDATE public.license_devices SET last_seen_at = now()
  WHERE license_id = v_lic.id AND device_fingerprint = p_device_fp;

  RETURN jsonb_build_object('valid', true, 'plan', v_lic.plan, 'expires_at', v_lic.expires_at);
END; $$;
```

---

## Tabela de Auditoria (Obrigatória para SaaS)

```sql
CREATE TABLE public.security_events (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type TEXT        NOT NULL,
  user_id    UUID        REFERENCES auth.users(id),
  ip_address TEXT,
  payload    JSONB       NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_sec_events_type    ON public.security_events(event_type);
CREATE INDEX idx_sec_events_user    ON public.security_events(user_id);
CREATE INDEX idx_sec_events_created ON public.security_events(created_at DESC);

ALTER TABLE public.security_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sec:admin:select" ON public.security_events FOR SELECT USING (public.is_admin());
-- INSERT apenas via SECURITY DEFINER functions — sem política de insert
```

### Eventos Padrão a Logar
```
license_activated   — ativação de licença
license_heartbeat   — verificação periódica
invalid_hmac        — assinatura inválida (possível ataque)
rate_limit_exceeded — muitas requisições
auth_failed         — tentativa de login falhada
permission_denied   — acesso negado por RLS
admin_action        — qualquer ação de admin
data_export         — exportação de dados
account_deleted     — deleção de conta
```

---

## Validação de Input em Edge Functions

```typescript
// Sempre usar Zod — nunca confiar em req.json() diretamente
import { z } from 'https://esm.sh/zod@3';

const schema = z.object({
  licenseKey: z.string().regex(/^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/,
    'Formato inválido: XXXX-XXXX-XXXX-XXXX'),
  deviceFp:   z.string().min(16).max(256),
  timestamp:  z.number().int().positive(),
  signature:  z.string().length(64), // SHA-256 = 64 hex chars
});

const parseResult = schema.safeParse(await req.json().catch(() => ({})));
if (!parseResult.success) {
  return json({ error: 'invalid_input', issues: parseResult.error.flatten() }, 400);
}
```

---

## Security Review Checklist (Pre-Deploy)

### Banco de Dados
- [ ] RLS habilitado em TODAS as tabelas (`SELECT tablename FROM pg_tables WHERE schemaname = 'public'`)
- [ ] Todas as políticas testadas com `SET LOCAL role TO authenticated` no SQL Editor
- [ ] RPCs sensíveis têm `SECURITY DEFINER` + `SET search_path = public`
- [ ] Secrets no Vault do Supabase (não em tabelas, não em env do código)
- [ ] Tabela `security_events` criada e com índices

### Edge Functions
- [ ] JWT validado antes de qualquer operação
- [ ] Input validado com Zod
- [ ] Rate limiting em endpoints públicos (autenticação, ativação, webhook)
- [ ] CORS restrito ao domínio da app (não `*` em produção)
- [ ] Nenhum `console.log` com dados sensíveis

### Cliente
- [ ] `VITE_*` não contém nenhuma key secreta
- [ ] Rotas admin protegidas por `requiredRole`
- [ ] Dados sensíveis não persistidos em localStorage/sessionStorage
- [ ] Tokens não expostos em URLs ou logs

### Geral
- [ ] Todas as ações admin logadas em `security_events`
- [ ] Anti-replay em operações críticas (HMAC com timestamp)
- [ ] Proteção contra brute force em login (via Supabase Auth settings)
