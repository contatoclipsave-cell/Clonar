---
name: lovable-data
description: >
  Camada de dados completa para projetos Lovable: schema PostgreSQL, migrations, queries TanStack Query,
  mutations, autenticação Supabase, Edge Functions, Storage e RLS. Use esta skill para TUDO que envolve
  dados: criar tabelas, escrever migrations, definir políticas RLS, hooks de busca/criação/edição/deleção,
  chamar Edge Functions, fazer upload de arquivos, e resolver erros de banco. É a única skill que toca
  o cliente Supabase, o schema do banco e as Edge Functions. Não define regras de segurança avançada
  (→ lovable-security) nem renderiza componentes visuais (→ lovable-ui).
---

# Lovable Data — Schema, Queries e Supabase

**Responsabilidade exclusiva:** Tudo que toca dados. O schema, as queries, as mutations, o cliente
Supabase, as Edge Functions e o Storage. A UI e a segurança avançada são de outras skills.

---

## Schema PostgreSQL — Template Canônico

Toda nova tabela segue esta estrutura na migration:

```sql
-- ================================================================
-- Migration: YYYYMMDD_nome_descritivo
-- Propósito: [descrever]
-- Rollback:  DROP TABLE public.[name]; (ou comandos de reversão)
-- ================================================================

-- Extensões (idempotente)
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Tabela
CREATE TABLE IF NOT EXISTS public.[entity] (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Campos de domínio aqui
  name       TEXT        NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  status     TEXT        NOT NULL DEFAULT 'active'
               CHECK (status IN ('active', 'inactive', 'deleted')),
  metadata   JSONB       NOT NULL DEFAULT '{}',

  -- Soft delete
  deleted_at TIMESTAMPTZ,

  -- Timestamps (gerenciados por trigger)
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Comentários
COMMENT ON TABLE  public.[entity] IS '[descrição da entidade]';
COMMENT ON COLUMN public.[entity].metadata IS 'Extensão JSON para campos variáveis';

-- Índices
CREATE INDEX IF NOT EXISTS idx_[entity]_user_id ON public.[entity](user_id);
CREATE INDEX IF NOT EXISTS idx_[entity]_status  ON public.[entity](status)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_[entity]_created ON public.[entity](created_at DESC);

-- Trigger de updated_at
CREATE TRIGGER [entity]_updated_at
  BEFORE UPDATE ON public.[entity]
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- RLS
ALTER TABLE public.[entity] ENABLE ROW LEVEL SECURITY;

CREATE POLICY "[entity]:select:own"  ON public.[entity] FOR SELECT
  USING (auth.uid() = user_id AND deleted_at IS NULL);
CREATE POLICY "[entity]:insert:own"  ON public.[entity] FOR INSERT
  WITH CHECK (auth.uid() = user_id);
CREATE POLICY "[entity]:update:own"  ON public.[entity] FOR UPDATE
  USING (auth.uid() = user_id AND deleted_at IS NULL);
CREATE POLICY "[entity]:softdelete"  ON public.[entity] FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (deleted_at IS NOT NULL); -- só pode setar deleted_at
```

### Tipos de Dados — Tabela Decisória

| Caso | Tipo correto | Evitar |
|------|-------------|--------|
| ID primário | `UUID DEFAULT gen_random_uuid()` | SERIAL, BIGSERIAL |
| FK para usuário | `UUID REFERENCES auth.users(id)` | INTEGER |
| Texto qualquer | `TEXT` | VARCHAR(n) |
| Valor monetário | `NUMERIC(12, 2)` | FLOAT, REAL, DOUBLE |
| Data/hora | `TIMESTAMPTZ` | TIMESTAMP sem TZ |
| Booleano | `BOOLEAN NOT NULL DEFAULT false` | TINYINT |
| Enum simples | `TEXT CHECK (val IN (...))` | ENUM nativo (rígido) |
| JSON variável | `JSONB NOT NULL DEFAULT '{}'` | JSON, TEXT |
| Array tipado | `TEXT[] NOT NULL DEFAULT '{}'` | JSON de array |

### Funções Utilitárias (criar uma vez no schema)

```sql
-- handle_updated_at: aplicar em toda tabela
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

-- is_admin: verificar role via JWT
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER AS $$
  SELECT COALESCE(
    (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin', false
  ); $$;

-- soft_delete: reutilizável para qualquer tabela com deleted_at
CREATE OR REPLACE FUNCTION public.soft_delete(
  p_table TEXT, p_id UUID
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  EXECUTE format(
    'UPDATE public.%I SET deleted_at = now() WHERE id = $1 AND auth.uid() = user_id',
    p_table
  ) USING p_id;
END; $$;
```

### Índices — Quando Criar

```sql
-- SEMPRE: FK, status, created_at
CREATE INDEX idx_t_user_id ON public.t(user_id);
CREATE INDEX idx_t_status  ON public.t(status) WHERE deleted_at IS NULL;
CREATE INDEX idx_t_created ON public.t(created_at DESC);

-- QUANDO há filtros compostos frequentes
CREATE INDEX idx_t_user_status ON public.t(user_id, status);

-- QUANDO há busca full-text
ALTER TABLE public.t ADD COLUMN IF NOT EXISTS search_vector TSVECTOR
  GENERATED ALWAYS AS (
    to_tsvector('portuguese', coalesce(name,'') || ' ' || coalesce(description,''))
  ) STORED;
CREATE INDEX idx_t_search ON public.t USING GIN(search_vector);

-- QUANDO há queries em JSONB
CREATE INDEX idx_t_metadata ON public.t USING GIN(metadata);
```

### Migrações Seguras (sem downtime)

```sql
-- ✅ Adicionar coluna nullable: online
ALTER TABLE public.t ADD COLUMN IF NOT EXISTS field TEXT;

-- ✅ Adicionar coluna com DEFAULT: online
ALTER TABLE public.t ADD COLUMN IF NOT EXISTS counter INTEGER NOT NULL DEFAULT 0;

-- ⚠️ Adicionar NOT NULL sem DEFAULT: 3 passos
ALTER TABLE public.t ADD COLUMN new_field TEXT;              -- 1. nullable
UPDATE public.t SET new_field = 'default' WHERE new_field IS NULL; -- 2. preencher
ALTER TABLE public.t ALTER COLUMN new_field SET NOT NULL;   -- 3. constraint

-- ✅ Renomear: cuidado com código existente
ALTER TABLE public.t RENAME COLUMN old TO new;
```

---

## Cliente Supabase

```typescript
// src/integrations/supabase/client.ts — NÃO ALTERAR ESTA ESTRUTURA
import { createClient } from '@supabase/supabase-js';
import type { Database } from './types';

export const supabase = createClient<Database>(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY  // ← anon key apenas (RLS faz o resto)
);
```

**Lei dos Keys:**
- `VITE_SUPABASE_ANON_KEY` → cliente browser (este arquivo)
- `SUPABASE_SERVICE_ROLE_KEY` → Edge Functions via `Deno.env.get(...)` **apenas**
- Nunca expor service role em `VITE_*`

---

## Padrão de Hooks de Dados

### Hook de Listagem

```typescript
// hooks/[feature]/use-[entities].ts
import type { Database } from '@/integrations/supabase/types';

type Product = Database['public']['Tables']['products']['Row'];

interface UseProductsFilters {
  status?: Product['status'];
  categoryId?: string;
  page?: number;
  limit?: number;
}

export const useProducts = (filters: UseProductsFilters = {}) => {
  const { status, categoryId, page = 1, limit = 20 } = filters;

  return useQuery({
    queryKey: ['products', { status, categoryId, page }],
    queryFn: async (): Promise<{ data: Product[]; count: number }> => {
      let query = supabase
        .from('products')
        .select('*, categories(name)', { count: 'exact' })
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
        .range((page - 1) * limit, page * limit - 1);

      if (status) query = query.eq('status', status);
      if (categoryId) query = query.eq('category_id', categoryId);

      const { data, error, count } = await query;
      if (error) throw new Error(SUPABASE_ERRORS[error.code] ?? error.message);
      return { data: data ?? [], count: count ?? 0 };
    },
    staleTime: 1000 * 60 * 3,
    placeholderData: keepPreviousData, // evita flash na paginação
  });
};
```

### Hook de Item Individual

```typescript
export const useProduct = (id: string | undefined) => {
  return useQuery({
    queryKey: ['products', id],
    queryFn: async (): Promise<Product> => {
      const { data, error } = await supabase
        .from('products')
        .select('*, categories(id, name), profiles(id, full_name)')
        .eq('id', id!)
        .is('deleted_at', null)
        .maybeSingle(); // null se não encontrar — sem erro

      if (error) throw new Error(error.message);
      if (!data) throw new Error('Produto não encontrado.');
      return data;
    },
    enabled: !!id, // não executar se id for undefined
  });
};
```

### Hook de Criação

```typescript
export const useCreateProduct = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: ProductInsert): Promise<Product> => {
      const { data, error } = await supabase
        .from('products')
        .insert({ ...input, user_id: (await supabase.auth.getUser()).data.user?.id! })
        .select()
        .single();

      if (error) throw new Error(SUPABASE_ERRORS[error.code] ?? error.message);
      return data;
    },
    onSuccess: (data) => {
      // Invalidar lista e atualizar cache do item
      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.setQueryData(['products', data.id], data);
      toast.success('Produto criado com sucesso!');
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });
};
```

### Hook de Atualização

```typescript
export const useUpdateProduct = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, ...updates }: ProductUpdate & { id: string }): Promise<Product> => {
      const { data, error } = await supabase
        .from('products')
        .update(updates)
        .eq('id', id)
        .select()
        .single();

      if (error) throw new Error(SUPABASE_ERRORS[error.code] ?? error.message);
      return data;
    },
    onSuccess: (data) => {
      queryClient.setQueryData(['products', data.id], data); // atualização otimista
      queryClient.invalidateQueries({ queryKey: ['products'] });
      toast.success('Produto atualizado!');
    },
    onError: (error: Error) => toast.error(error.message),
  });
};
```

### Hook de Deleção (Soft Delete)

```typescript
export const useDeleteProduct = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      const { error } = await supabase
        .from('products')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', id);

      if (error) throw new Error(error.message);
    },
    onSuccess: (_data, id) => {
      queryClient.removeQueries({ queryKey: ['products', id] });
      queryClient.invalidateQueries({ queryKey: ['products'] });
      toast.success('Produto removido.');
    },
    onError: (error: Error) => toast.error(error.message),
  });
};
```

---

## Edge Functions

```typescript
// supabase/functions/[name]/index.ts — Template completo
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { z } from 'https://esm.sh/zod@3';

// Schema de validação de input
const bodySchema = z.object({
  // definir campos aqui
});

const CORS = {
  'Access-Control-Allow-Origin': Deno.env.get('ALLOWED_ORIGIN') ?? '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'X-Content-Type-Options': 'nosniff',
};

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });

  try {
    // 1. Autenticar
    const token = req.headers.get('Authorization')?.replace('Bearer ', '');
    if (!token) return json({ error: 'Unauthorized' }, 401);

    const adminClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const { data: { user }, error: authErr } = await adminClient.auth.getUser(token);
    if (authErr || !user) return json({ error: 'Invalid token' }, 401);

    // 2. Validar input
    const parseResult = bodySchema.safeParse(await req.json());
    if (!parseResult.success) {
      return json({ error: 'Invalid input', details: parseResult.error.issues }, 400);
    }

    // 3. Lógica da função
    const body = parseResult.data;

    // ... processar ...

    return json({ success: true });

  } catch (err) {
    console.error(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
    return json({ error: 'Internal server error' }, 500);
  }
});
```

### Chamar Edge Function do cliente

```typescript
export const useCallFunction = <TInput, TOutput>(functionName: string) => {
  return useMutation<TOutput, Error, TInput>({
    mutationFn: async (payload) => {
      const { data, error } = await supabase.functions.invoke<TOutput>(functionName, {
        body: payload,
      });
      if (error) throw new Error(error.message);
      return data!;
    },
  });
};
```

---

## Storage

```typescript
// lib/storage.ts
export const uploadToStorage = async (
  bucket: string,
  path: string,
  file: File,
  options?: { upsert?: boolean }
): Promise<string> => {
  const { error } = await supabase.storage.from(bucket).upload(path, file, {
    cacheControl: '3600',
    upsert: options?.upsert ?? false,
  });

  if (error) throw new Error(error.message);
  return supabase.storage.from(bucket).getPublicUrl(path).data.publicUrl;
};

export const deleteFromStorage = async (bucket: string, path: string): Promise<void> => {
  const { error } = await supabase.storage.from(bucket).remove([path]);
  if (error) throw new Error(error.message);
};
```

---

## Mapa de Erros Supabase

```typescript
// lib/supabase-errors.ts
export const SUPABASE_ERRORS: Record<string, string> = {
  '23505': 'Este registro já existe.',
  '23503': 'Referência a dado inexistente.',
  '23502': 'Campo obrigatório não preenchido.',
  '42501': 'Sem permissão para esta operação.',
  '42P01': 'Tabela não encontrada.',
  'PGRST116': 'Registro não encontrado.',
  'PGRST301': 'Sem autorização.',
  '57014': 'Query cancelada por timeout.',
};
```

---

## RLS — Políticas por Padrão de Acesso

```sql
-- Padrão 1: Dados privados do usuário (mais comum)
CREATE POLICY "own:select" ON t FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "own:insert" ON t FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own:update" ON t FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "own:delete" ON t FOR DELETE USING (auth.uid() = user_id);

-- Padrão 2: Dados públicos com escrita privada
CREATE POLICY "pub:select" ON t FOR SELECT USING (true);
CREATE POLICY "auth:insert" ON t FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

-- Padrão 3: Admin tudo, usuário só o seu
CREATE POLICY "admin:all"  ON t USING (public.is_admin());
CREATE POLICY "user:own"   ON t FOR SELECT USING (auth.uid() = user_id);

-- Padrão 4: Compartilhado por organização (multi-tenant)
CREATE POLICY "org:select" ON t FOR SELECT
  USING (org_id IN (
    SELECT org_id FROM public.org_members WHERE user_id = auth.uid()
  ));
```

---

## Checklist de Qualidade — Data Layer

- [ ] Toda nova tabela tem `id`, `user_id`, `created_at`, `updated_at`, trigger e RLS
- [ ] Toda FK tem `ON DELETE` explícito (CASCADE / RESTRICT / SET NULL)
- [ ] `service_role` key nunca em variável `VITE_*`
- [ ] Queries retornam tipos derivados de `Database` (não `any`)
- [ ] Erros do Supabase mapeados para mensagens PT-BR antes do toast
- [ ] Mutations invalidam as queries corretas por queryKey prefix
- [ ] Edge Functions validam JWT + input com Zod antes de processar
- [ ] Listas com potencial de crescimento têm paginação desde o início
- [ ] Colunas filtradas com frequência têm índice no schema
