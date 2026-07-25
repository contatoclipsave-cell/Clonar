# Lovable Dev Framework — Guia do Sistema

## Visão Geral

Framework de desenvolvimento profissional para projetos Lovable. Equivalente ao fluxo de trabalho
de uma equipe sênior com papéis bem definidos e sem sobreposição de responsabilidades.

```
┌──────────────────────────────────────────────────────────────────────┐
│                       lovable-architect                              │
│           (Orchestrator — sempre consultado primeiro)                │
│   Analisa → Classifica → Planeja → Coordena → Verifica              │
└────────────┬────────────────────────────────────────────────────────┘
             │ delega para
    ┌────────┴───────────────────────────────────────────┐
    │                                                     │
┌───▼────────┐  ┌───────────┐  ┌────────┐  ┌──────────┐ │
│lovable-core│  │lovable-data│  │lovable │  │ lovable  │ │
│            │  │            │  │  -ui   │  │-security │ │
│React/TS    │  │Supabase    │  │shadcn/ │  │Auth/HMAC │ │
│Hooks/State │  │Schema/Query│  │Forms/  │  │RLS/Audit │ │
│Routes/Error│  │Edge Fn/RLS │  │Tables  │  │Licensing │ │
└────────────┘  └───────────┘  └────────┘  └──────────┘ │
    ┌──────────────────┐   ┌─────────────────────────────┘
    │ lovable-performance│   │ lovable-quality
    │ Bundle/Cache/DB   │   │ Debug/Review/Refactor
    │ Memoização/N+1    │   │ Causa Raiz/Prevenção
    └───────────────────┘   └──────────────────────────
```

---

## Mapa de Responsabilidades (sem sobreposição)

| Skill | Dono exclusivo de |
|-------|-------------------|
| `lovable-architect` | Orchestração, plano de execução, regras globais, checklist final |
| `lovable-core` | Componentes React, hooks, Context, rotas, tipagem TypeScript |
| `lovable-data` | Schema SQL, migrations, queries TanStack Query, Edge Functions, Storage, RLS (SQL) |
| `lovable-security` | Quais proteções são necessárias, HMAC, rate limiting, auditoria, verificação de segurança |
| `lovable-ui` | Componentes visuais, formulários, tabelas, design tokens, estados de UI |
| `lovable-performance` | Bundle, cache, N+1, memoização, Core Web Vitals |
| `lovable-quality` | Debugging, code review, refactoring, prevenção de regressão |

### Onde vai o RLS? (exemplo de boundary)
- **lovable-data** → escreve o SQL das policies (`CREATE POLICY ...`)
- **lovable-security** → define quais policies são necessárias, verifica que estão corretas, adiciona camadas extras (HMAC, rate limiting)

### Onde vai a autenticação?
- **lovable-data** → `supabase.auth.getSession()`, hook `useAuth`, listener `onAuthStateChange`
- **lovable-security** → guards de rota (`ProtectedRoute`), validação JWT em Edge Functions, políticas de acesso por role
- **lovable-core** → `AuthContext`, `AuthProvider`, integração com rotas React Router

---

## Fluxos de Execução por Complexidade

### Tarefa S (Simples) — 1 skill, sem plano
```
Exemplo: "Corrigir erro de TypeScript no ProductCard"
→ lovable-quality (diagnóstico direto)

Exemplo: "Adicionar campo de busca na lista"
→ lovable-ui (componente direto)
```

### Tarefa M (Média) — 2-3 skills, plano mental
```
Exemplo: "Criar formulário de edição de produto"
→ lovable-ui (formulário) + lovable-core (hook de edição)
→ Depende de: hook de useProduct e useUpdateProduct (lovable-data — se não existir, criar antes)

Exemplo: "Adicionar coluna 'view_count' na tabela"
→ lovable-data (migration + índice + RLS) → lovable-security (verificar policy)
```

### Tarefa L (Grande) — todas as skills relevantes, plano escrito
```
Exemplo: "Criar módulo de comentários em posts"

Plano:
1. lovable-data     → tabela comments (schema + RLS + índices)
2. lovable-security → verificar policies (usuário vê comentários do post público?)
3. lovable-data     → hooks (useComments, useCreateComment, useDeleteComment)
4. lovable-core     → CommentContext ou hook de estado local?
5. lovable-ui       → CommentList, CommentForm, CommentCard
6. lovable-quality  → review final: tipos, acessibilidade, estados
```

### Tarefa XL (Épico) — sub-planos por módulo, múltiplas iterações
```
Exemplo: "Implementar sistema de assinatura com Stripe"

Fase 1 — Schema (lovable-data + lovable-security)
  → Tabelas: subscriptions, plans, billing_events
  → RLS completa, audit log

Fase 2 — Integração Stripe (lovable-data + lovable-security)
  → Edge Function: create-checkout-session
  → Edge Function: stripe-webhook (HMAC verification)
  → Validação de assinatura com rate limiting

Fase 3 — Lógica de Acesso (lovable-core + lovable-security)
  → useSubscription hook
  → FeatureGate component (acesso por plano)
  → ProtectedRoute com verificação de plano

Fase 4 — UI (lovable-ui)
  → PricingPage, CheckoutFlow, BillingSettings
  → Todos os estados: loading, success, error, upgrade required

Fase 5 — Qualidade + Performance (lovable-quality + lovable-performance)
  → Code review completo
  → Cache de subscription status
  → Checklist de segurança pre-deploy
```

---

## Regras Globais Rápidas

```
✅ Imports: sempre @/ (nunca caminhos relativos com ../)
✅ IDs: sempre UUID, nunca SERIAL
✅ Timestamps: sempre TIMESTAMPTZ
✅ Dinheiro: sempre NUMERIC(12,2), nunca FLOAT
✅ queryKeys: ['entidade', escopo?, filtros?]
✅ Erros Supabase: mapear para PT-BR antes do toast
✅ State server: TanStack Query (nunca useState + useEffect)
✅ Segredos: Vault do Supabase ou env do servidor (nunca VITE_*)

❌ any em TypeScript
❌ console.log em produção
❌ Editar src/components/ui/
❌ service_role em VITE_*
❌ fetch() direto para Supabase (usar supabase-js client)
❌ RLS desabilitado em tabelas com dados de usuário
❌ Índice de array como key em listas React
❌ useEffect para data fetching
```

---

## Skills por Cenário

| Cenário | Skills |
|---------|--------|
| Novo projeto do zero | architect → data → security → core → ui |
| Nova feature CRUD | architect → data → core → ui → quality |
| Novo módulo SaaS | architect → data → security → core → ui → performance → quality |
| Bug de UI | quality → ui |
| Bug de banco/RLS | quality → data → security |
| Lentidão no app | performance → data (índices) + core (memoização) |
| Review pré-deploy | quality → security → performance |
| Refactoring | quality → core (hooks) ou ui (componentes) |
