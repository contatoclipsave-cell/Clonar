# Global Rules — Lovable Framework

Este arquivo é carregado pelo `lovable-architect` quando a tarefa exige detalhamento das regras globais.

---

## Estrutura de Pastas Canônica

```
src/
├── components/
│   ├── ui/                    # shadcn/ui — NUNCA editar
│   ├── layout/                # AppLayout, Sidebar, Header, Footer
│   ├── shared/                # Componentes genéricos cross-feature
│   └── [feature]/             # Ex: products/, billing/, auth/
│       ├── ProductCard.tsx
│       ├── ProductForm.tsx
│       └── ProductList.tsx
├── hooks/
│   ├── use-auth.ts            # Estado de autenticação global
│   └── [feature]/             # Ex: products/use-products.ts
├── pages/
│   ├── Index.tsx              # Rota raiz
│   ├── auth/
│   └── [feature]/
├── lib/
│   ├── utils.ts               # cn() e helpers genéricos
│   ├── validators.ts          # Schemas Zod reutilizáveis
│   └── constants.ts           # Constantes da aplicação
├── integrations/
│   └── supabase/
│       ├── client.ts          # createClient — NÃO alterar
│       └── types.ts           # Gerado automaticamente — NÃO alterar
├── contexts/
│   ├── auth-context.tsx       # Contexto de autenticação
│   └── [feature]-context.tsx
└── types/
    ├── database.types.ts      # Re-exports de Database
    └── [feature].types.ts     # Tipos de domínio
```

---

## Convenções de queryKey

```typescript
// Padrão: [entidade, escopo?, filtros?]
// Entidade sempre string, escopo e filtros opcionais

// ✅ Correto
['products']                           // todos os produtos
['products', userId]                   // produtos do usuário
['products', userId, { status }]       // produtos filtrados
['products', productId]                // produto específico
['products', productId, 'comments']    // recurso aninhado

// ✅ Invalidação por prefixo
queryClient.invalidateQueries({ queryKey: ['products'] })
// invalida todos acima

// ❌ Errado
['getProducts']      // verbo no key
['product_list']     // snake_case
['Products']         // PascalCase
```

---

## Padrão de Error Handling em Camadas

```
Camada DB       → PostgreSQL lança erro com código
Camada Supabase → supabase-js retorna { error }
Camada Hook     → relança como Error nativo com mensagem PT-BR
Camada UI       → captura e exibe via toast ou FormMessage
```

```typescript
// Hook: converter erro do Supabase em Error nativo
const { data, error } = await supabase.from('products').select('*');
if (error) {
  // Mapear código para mensagem amigável
  const message = SUPABASE_ERROR_MAP[error.code] ?? error.message;
  throw new Error(message);
}

// Mapa de erros
const SUPABASE_ERROR_MAP: Record<string, string> = {
  '23505': 'Este registro já existe.',
  '23503': 'Referência inválida.',
  '42501': 'Sem permissão para esta operação.',
  'PGRST116': 'Registro não encontrado.',
};
```

---

## Padrão Multi-tenant (quando aplicável)

```typescript
// Toda query deve ser scoped ao user ou org
const useProducts = () => useQuery({
  queryKey: ['products', user.id],
  queryFn: async () => {
    // RLS garante o escopo, mas o queryKey precisa refletir isso
    const { data, error } = await supabase
      .from('products')
      .select('*');
    if (error) throw new Error(error.message);
    return data;
  },
});

// Para multi-org: adicionar org_id em todas as tabelas
// e policies checando org membership
```

---

## Padrão de Feature Flag

```typescript
// src/lib/feature-flags.ts
export const FLAGS = {
  BILLING_V2: import.meta.env.VITE_FLAG_BILLING_V2 === 'true',
  NEW_DASHBOARD: import.meta.env.VITE_FLAG_NEW_DASHBOARD === 'true',
} as const;

// Uso em componente
if (FLAGS.BILLING_V2) {
  return <BillingV2 />;
}
```
