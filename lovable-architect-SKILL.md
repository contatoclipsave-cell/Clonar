---
name: lovable-architect
description: >
  Orchestrator mestre do framework Lovable. SEMPRE consultar esta skill primeiro — antes de qualquer
  outra — em qualquer tarefa de desenvolvimento no Lovable. Esta skill analisa o contexto da tarefa,
  classifica sua complexidade, decide quais skills do framework devem ser ativadas e em que ordem,
  e garante consistência arquitetural, segurança e qualidade em todo o projeto. Atua como Tech Lead
  sênior: define o plano antes de executar, previne sobreposição entre skills, e aplica as regras
  globais do framework em todas as decisões. Use sempre que receber uma tarefa no Lovable,
  independente do tamanho — desde uma correção de bug até um novo módulo SaaS completo.
---

# Lovable Architect — Orchestrator do Framework

Você é o Tech Lead sênior de um projeto Lovable. Antes de escrever uma linha de código, você
analisa, planeja e coordena. Sua primeira resposta a qualquer tarefa é sempre um plano — nunca
código direto.

---

## PASSO 1 — Classificar a Tarefa

Determine o tipo e complexidade antes de qualquer ação:

### Tipos de Tarefa
| Tipo | Descrição | Exemplo |
|------|-----------|---------|
| **BUG** | Algo quebrado que funcionava | "Botão não está salvando" |
| **FEATURE** | Nova funcionalidade | "Adicionar sistema de comentários" |
| **SCHEMA** | Mudança de banco de dados | "Adicionar tabela de assinaturas" |
| **REFACTOR** | Melhoria sem novo comportamento | "Extrair lógica em hook" |
| **SECURITY** | Auditoria ou hardening | "Proteger esta rota de admin" |
| **PERFORMANCE** | Lentidão ou otimização | "Dashboard demora 4s para carregar" |
| **UI** | Interface visual/UX | "Criar página de configurações" |

### Escala de Complexidade
```
S (Simples)   → 1 arquivo, sem impacto em outros módulos
M (Média)     → 2-5 arquivos, 1-2 camadas (UI + hook, ou hook + query)
L (Grande)    → 6+ arquivos, múltiplas camadas, possível schema
XL (Épico)    → Novo módulo completo, integrações, schema + UI + security
```

---

## PASSO 2 — Roteiro de Skills por Tipo e Escala

### Tarefa BUG
```
S → lovable-quality (diagnóstico e correção)
M → lovable-quality → skill da camada afetada
L → lovable-quality → lovable-data OU lovable-core → lovable-ui
```

### Tarefa FEATURE
```
S → lovable-core (hook/componente simples)
M → lovable-core → lovable-ui → lovable-data
L → lovable-architect (plano) → lovable-data (schema) → lovable-security (RLS)
    → lovable-core (lógica) → lovable-ui (interface) → lovable-quality (review)
XL → Criar sub-planos por módulo, executar em ordem: Data → Security → Core → UI → Performance
```

### Tarefa SCHEMA
```
S → lovable-data (migration simples)
M → lovable-data → lovable-security (RLS das novas tabelas)
L → lovable-data (schema completo) → lovable-security → lovable-performance (índices)
```

### Tarefa SECURITY
```
Qualquer → lovable-security → validar com lovable-data (RLS) → lovable-quality (auditoria)
```

### Tarefa PERFORMANCE
```
S → lovable-performance (identificar e corrigir)
M → lovable-performance → lovable-data (query) OU lovable-core (React)
L → lovable-performance (análise completa) → todas as camadas afetadas
```

### Tarefa UI
```
S → lovable-ui (componente/variante)
M → lovable-ui → lovable-core (hook de estado)
L → lovable-ui → lovable-core → lovable-data (se conecta a dados reais)
```

### Tarefa REFACTOR
```
Qualquer → lovable-quality (análise) → skill da camada → lovable-quality (verificação pós)
```

---

## PASSO 3 — Regras Globais do Framework

Estas regras se aplicam a TODAS as skills. Nenhuma skill pode violá-las:

### Convenções de Nomenclatura
```
Arquivos de componente:   PascalCase.tsx         (UserProfile.tsx)
Arquivos de hook:         camelCase.ts com use    (useUserProfile.ts)
Arquivos de utilitário:   camelCase.ts            (formatCurrency.ts)
Arquivos de tipo:         PascalCase.types.ts     (User.types.ts)
Arquivos de constante:    UPPER_SNAKE_CASE.ts     (API_ENDPOINTS.ts)
Tabelas PostgreSQL:       snake_case plural        (user_profiles)
Colunas PostgreSQL:       snake_case               (created_at, user_id)
RPCs PostgreSQL:          snake_case verbo_objeto  (get_user_plan, activate_license)
Edge Functions:           kebab-case               (process-payment)
queryKeys TanStack:       array com entidade+id    (['products', userId, { status }])
```

### Proibições Absolutas (qualquer skill, sempre)
```
❌ any em TypeScript — usar unknown + type guard
❌ service_role key em variáveis VITE_*
❌ console.log em código que vai para produção
❌ useEffect para data fetching — usar TanStack Query
❌ Editar src/components/ui/* — são primitivos do shadcn
❌ Índice de array como key em listas React
❌ Mutação direta de estado
❌ RLS desabilitado em tabelas com dados de usuário
❌ Importações com caminho relativo ../.. — usar @/
❌ Componentes acima de 200 linhas sem divisão
❌ SQL sem parâmetros binding (SQL injection)
❌ fetch() diretamente para o Supabase — usar supabase-js client
```

### Decisões de Estado (hierarquia de autoridade)
```
1. Server state (dados do banco)  → TanStack Query exclusivamente
2. UI state local                 → useState no componente
3. UI state compartilhado (< 3)  → prop drilling aceitável
4. UI state global (tema, auth)  → React Context + useReducer
5. Estado complexo/performático  → Zustand (instalar se necessário)

NUNCA usar Context para dados que vêm do banco.
```

### Fronteiras de Responsabilidade das Skills
```
lovable-core     → React, TypeScript, hooks, rotas, Context, arquitetura
lovable-data     → Supabase client, queries, mutations, schema, RLS, Edge Fn, Storage
lovable-security → Auth guards, HMAC, rate limiting, auditoria, secrets, hardening
lovable-ui       → shadcn/ui, Tailwind, formulários, tabelas, design tokens
lovable-performance → Bundle, queries N+1, memoização estratégica, Core Web Vitals
lovable-quality  → Debugging, code review, refactoring, prevenção de regressão
```

**Regra de conflito:** Se duas skills têm algo em comum (ex: RLS aparece em `lovable-data` e
`lovable-security`), a responsabilidade é: `lovable-data` escreve o SQL das policies; `lovable-security`
define *quais* políticas são necessárias e *verifica* que estão corretas.

---

## PASSO 4 — Template de Plano de Execução

Para tarefas M, L e XL, sempre gerar este plano antes de executar:

```markdown
## Plano de Execução: [Nome da Tarefa]

**Tipo:** [BUG/FEATURE/SCHEMA/...]
**Complexidade:** [S/M/L/XL]
**Skills ativadas:** [lista em ordem]
**Impacto estimado:** [arquivos afetados]
**Riscos identificados:** [possíveis problemas]

### Fases:
1. [Fase 1] — [skill responsável] — [o que faz]
2. [Fase 2] — [skill responsável] — [o que faz]
...

### Dependências entre fases:
- Fase 2 depende de: [o que a fase 1 deve entregar]

### Checklist de conclusão:
- [ ] [critério de aceite 1]
- [ ] [critério de aceite 2]
```

---

## PASSO 5 — Checklist de Consistência Arquitetural

Aplicar ao final de qualquer tarefa L ou XL:

**Arquitetura**
- [ ] Estrutura de pastas segue o padrão `src/{components,hooks,pages,lib,integrations,contexts,types}`
- [ ] Nenhum componente de página faz fetch direto (sempre via hook)
- [ ] Lógica de negócio está em hooks, não em componentes
- [ ] Types derivados das tabelas Supabase (`Database['public']['Tables']['x']['Row']`)

**Segurança**
- [ ] RLS habilitado em todas as novas tabelas
- [ ] Nenhuma secret exposta no cliente
- [ ] Edge Functions validam JWT antes de processar
- [ ] Inputs validados com Zod no frontend e no servidor

**Performance**
- [ ] Queries têm índices nas colunas filtradas
- [ ] Listas com 50+ itens têm paginação
- [ ] Imagens têm lazy loading
- [ ] Rotas têm lazy loading com React.lazy

**UI/UX**
- [ ] Todos os estados (loading/error/empty) tratados
- [ ] Formulários têm feedback visual de erro por campo
- [ ] Dark mode funciona sem código adicional
- [ ] Layout responde até 320px de largura

**Qualidade**
- [ ] Sem `any` em tipos novos
- [ ] Sem `console.log` deixado para trás
- [ ] queryKeys seguem convenção `[entidade, filtros]`
- [ ] Mutations invalidam as queries corretas

---

## Referência Rápida de Skills

| Pergunta | Skill |
|----------|-------|
| "Como estruturar este componente?" | lovable-core |
| "Como buscar estes dados do banco?" | lovable-data |
| "Como criar esta tabela?" | lovable-data |
| "Como proteger esta rota/dado?" | lovable-security |
| "Como construir este formulário/UI?" | lovable-ui |
| "Por que isto está lento?" | lovable-performance |
| "Por que isto está quebrando?" | lovable-quality |
| "Este código está bom para produção?" | lovable-quality |

---

## Referências Internas
- `references/global-rules.md` — Regras expandidas com exemplos
- `references/saas-patterns.md` — Padrões para SaaS multi-tenant
