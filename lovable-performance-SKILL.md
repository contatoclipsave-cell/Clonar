---
name: lovable-performance
description: >
  Otimização de performance para projetos Lovable: queries N+1, bundle size, memoização React,
  Core Web Vitals, lazy loading estratégico, paginação eficiente, cache TanStack Query e análise
  de re-renders. Use esta skill quando o projeto estiver lento (dashboards, listas grandes, carregamento
  de página), ao preparar para produção, ao adicionar funcionalidades que podem degradar performance
  (relatórios, uploads, listas longas), ou quando o Lighthouse score estiver abaixo de 80.
  Ativada pelo lovable-architect em tarefas de Performance, e como etapa final em tarefas XL.
  Não cria componentes visuais (→ lovable-ui) nem modifica schema sem coordenar com lovable-data.
---

# Lovable Performance — Otimização de Ponta a Ponta

**Responsabilidade exclusiva:** Identificar e eliminar gargalos de performance em todas as camadas —
banco, rede, bundle, React runtime. Opera após as outras skills definirem a solução funcional.

---

## Diagnóstico — Por Onde Começar

```
Pergunta 1: O problema é no carregamento inicial ou durante uso?
  → Carregamento → Bundle size, lazy loading, queries pesadas
  → Durante uso  → Re-renders, queries N+1, cache miss

Pergunta 2: O problema é no servidor ou no cliente?
  → Console → Network tab → verificar tempo de resposta das APIs
  → Se > 500ms na API → otimizar query/índice (lovable-data + lovable-performance)
  → Se < 100ms na API mas UI lenta → React performance

Pergunta 3: O problema é consistente ou esporádico?
  → Consistente → query lenta, componente pesado, bundle grande
  → Esporádico  → re-fetch desnecessário, race condition, throttling
```

---

## Camada 1: Banco de Dados

### Detectar queries lentas no Supabase

```sql
-- Verificar queries sem índice (seq scan em tabelas grandes)
EXPLAIN ANALYZE SELECT * FROM products WHERE status = 'active' AND user_id = auth.uid();
-- "Seq Scan" em tabela > 1000 linhas = índice faltando

-- Índice composto para filtros frequentes
CREATE INDEX CONCURRENTLY idx_products_user_status
  ON public.products(user_id, status)
  WHERE deleted_at IS NULL; -- partial: ignora deletados

-- CONCURRENTLY = não bloqueia a tabela durante criação
```

### Problema N+1 no Supabase

```typescript
// ❌ N+1: 1 query para produtos + 1 para cada categoria
const products = await supabase.from('products').select('*');
// Para cada produto...
const category = await supabase.from('categories').select('*').eq('id', product.category_id);

// ✅ Join na query (1 query total)
const { data } = await supabase
  .from('products')
  .select(`
    id, name, price, status,
    categories ( id, name, slug ),
    profiles ( id, full_name, avatar_url )
  `)
  .is('deleted_at', null)
  .order('created_at', { ascending: false });
// data[n].categories.name — sem queries extras
```

### Paginação Eficiente

```typescript
// ❌ Buscar tudo e filtrar no cliente
const { data } = await supabase.from('products').select('*');
const filtered = data.filter(p => p.status === 'active'); // 10k+ registros na memória

// ✅ Paginação no banco
const PAGE_SIZE = 20;
const { data, count } = await supabase
  .from('products')
  .select('*', { count: 'exact' })
  .eq('status', 'active')
  .range(pageIndex * PAGE_SIZE, (pageIndex + 1) * PAGE_SIZE - 1);
// count = total para calcular páginas; data = só a página atual
```

### Views Materializadas para Relatórios

```sql
-- Para dashboards com agregações pesadas que rodam muitas vezes
CREATE MATERIALIZED VIEW public.product_stats AS
  SELECT
    user_id,
    COUNT(*)                          AS total_products,
    COUNT(*) FILTER (WHERE status = 'published') AS published,
    SUM(price)                        AS total_value,
    AVG(price)                        AS avg_price,
    MAX(created_at)                   AS latest_created
  FROM public.products
  WHERE deleted_at IS NULL
  GROUP BY user_id;

CREATE UNIQUE INDEX ON public.product_stats(user_id);

-- Atualizar periodicamente (ou via trigger após mutations)
REFRESH MATERIALIZED VIEW CONCURRENTLY public.product_stats;
```

---

## Camada 2: Cache TanStack Query

### Configuração Otimizada do QueryClient

```typescript
// src/lib/query-client.ts
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime:            1000 * 60 * 5,    // 5min: não refetch desnecessário
      gcTime:               1000 * 60 * 30,   // 30min: manter no cache inativo
      retry:                2,                 // 2 tentativas em erro de rede
      refetchOnWindowFocus: false,             // evitar refetch ao trocar aba
      refetchOnReconnect:   true,              // refetch ao reconectar
    },
    mutations: {
      retry: 0, // mutations não fazem retry automático
    },
  },
});
```

### Prefetch para Navegação Instantânea

```typescript
// Prefetch ao hover (antes do click)
const handleMouseEnter = () => {
  queryClient.prefetchQuery({
    queryKey: ['products', productId],
    queryFn:  () => fetchProduct(productId),
    staleTime: 1000 * 60 * 5,
  });
};

<Link to={`/products/${productId}`} onMouseEnter={handleMouseEnter}>
  Ver produto
</Link>
```

### Optimistic Updates (UX instantânea)

```typescript
export const useToggleProductStatus = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      supabase.from('products').update({ status }).eq('id', id),

    onMutate: async ({ id, status }) => {
      // Cancelar refetch em andamento
      await queryClient.cancelQueries({ queryKey: ['products'] });

      // Snapshot do estado anterior
      const previous = queryClient.getQueryData<Product[]>(['products']);

      // Atualizar cache otimisticamente
      queryClient.setQueryData<Product[]>(['products'], old =>
        old?.map(p => p.id === id ? { ...p, status } : p) ?? []
      );

      return { previous }; // para rollback
    },

    onError: (_err, _vars, context) => {
      // Rollback em caso de erro
      if (context?.previous) {
        queryClient.setQueryData(['products'], context.previous);
      }
      toast.error('Falha ao atualizar status.');
    },

    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['products'] });
    },
  });
};
```

---

## Camada 3: Bundle e Carregamento

### Lazy Loading de Rotas (obrigatório)

```typescript
// ❌ Importação síncrona — todo o bundle carregado no início
import DashboardPage from '@/pages/DashboardPage';
import ProductsPage  from '@/pages/ProductsPage';

// ✅ Lazy loading — cada rota carregada apenas quando acessada
const DashboardPage = lazy(() => import('@/pages/DashboardPage'));
const ProductsPage  = lazy(() => import('@/pages/ProductsPage'));
const ReportsPage   = lazy(() => import('@/pages/ReportsPage'));    // heavy
const AdminPage     = lazy(() => import('@/pages/admin/AdminPage')); // raro

// Com Suspense e fallback
<Suspense fallback={<PageSkeleton />}>
  <DashboardPage />
</Suspense>
```

### Code Splitting de Componentes Pesados

```typescript
// Componentes com bibliotecas grandes (charts, editors, maps)
const RichTextEditor = lazy(() =>
  import('@/components/shared/RichTextEditor').then(m => ({ default: m.RichTextEditor }))
);

const SalesChart = lazy(() => import('@/components/dashboard/SalesChart'));

// Carregar apenas quando necessário (ex: aba ativa)
{activeTab === 'analytics' && (
  <Suspense fallback={<ChartSkeleton />}>
    <SalesChart data={analyticsData} />
  </Suspense>
)}
```

### Análise de Bundle

```bash
# Verificar o que está pesando no bundle
# No terminal (fora do Lovable, em ambiente local):
npx vite-bundle-visualizer

# Targets: cada chunk < 200KB gzipped
# Suspeitos comuns: date-fns (usar date-fns/esm), lodash (usar lodash-es),
# moment.js (substituir por date-fns), chart.js (usar recharts modular)
```

---

## Camada 4: React Runtime

### Quando Usar memo, useMemo, useCallback

```typescript
// REGRA: não otimizar prematuramente. Memoizar quando:
// 1. memo() → componente filho de lista que re-renderiza com props iguais
// 2. useMemo() → cálculo custoso (> 1ms) ou referência estável para deps
// 3. useCallback() → função passada como prop ou em deps de useEffect

// ✅ memo() — componente em lista com re-renders frequentes do pai
export const ProductCard = memo(({ product, onSelect }: ProductCardProps) => {
  // ...
}, (prevProps, nextProps) => {
  // Comparação customizada se necessário
  return prevProps.product.id === nextProps.product.id
    && prevProps.product.status === nextProps.product.status;
});

// ✅ useMemo() — derivação custosa
const expensiveStats = useMemo(() => {
  return products.reduce((acc, p) => ({
    total: acc.total + p.price,
    count: acc.count + 1,
    avgPrice: (acc.total + p.price) / (acc.count + 1),
  }), { total: 0, count: 0, avgPrice: 0 });
}, [products]); // só recalcula quando products muda

// ✅ useCallback() — handler passado como prop
const handleDelete = useCallback(async (id: string) => {
  await deleteMutation.mutateAsync(id);
}, [deleteMutation]);

// ❌ NÃO memoizar — overhead desnecessário:
const label = useMemo(() => `${count} itens`, [count]); // trivial, não precisa
```

### Detectar Re-renders Excessivos

```typescript
// Diagnóstico rápido: adicionar temporariamente e remover depois
const renderCount = useRef(0);
useEffect(() => {
  renderCount.current += 1;
  console.log(`[ProductList] render #${renderCount.current}`);
});

// Causa 1: prop de objeto novo a cada render do pai
<Component config={{ theme: 'dark' }} /> // ← novo objeto toda vez
// Solução: memoizar no pai
const config = useMemo(() => ({ theme: 'dark' }), []);

// Causa 2: Context causando re-render de toda a árvore
// Solução: dividir Context em partes (authContext, themeContext separados)
// ou usar Zustand para estado frequentemente mutado

// Causa 3: State lifting desnecessário — mover estado para baixo
// Se só 1 componente usa o state, mover para dentro dele
```

### Virtualização para Listas Longas

```typescript
// Para listas com 100+ itens sem paginação (ex: timeline, chat, logs)
import { useVirtualizer } from '@tanstack/react-virtual';

const VirtualList = ({ items }: { items: LogEntry[] }) => {
  const parentRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count:          items.length,
    getScrollElement: () => parentRef.current,
    estimateSize:   () => 60, // altura estimada por item
    overscan:       5,         // renderizar 5 itens fora da view
  });

  return (
    <div ref={parentRef} className="h-[600px] overflow-auto">
      <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
        {virtualizer.getVirtualItems().map(virtualItem => (
          <div
            key={virtualItem.key}
            style={{
              position: 'absolute',
              top:    virtualItem.start,
              width:  '100%',
              height: virtualItem.size,
            }}
          >
            <LogEntryRow entry={items[virtualItem.index]} />
          </div>
        ))}
      </div>
    </div>
  );
};
```

---

## Métricas Alvo (Produção)

| Métrica | Alvo | Crítico |
|---------|------|---------|
| LCP (Largest Contentful Paint) | < 2.5s | > 4s |
| FID / INP (Interação) | < 100ms | > 300ms |
| CLS (Layout Shift) | < 0.1 | > 0.25 |
| Bundle JS (gzipped) | < 200KB | > 500KB |
| Queries de listagem | < 200ms | > 1s |
| Queries de item único | < 100ms | > 500ms |
| Time to Interactive | < 3.5s | > 7.5s |

---

## Checklist de Performance — Pre-Deploy

**Banco**
- [ ] `EXPLAIN ANALYZE` nas queries principais — sem Seq Scan em tabelas > 1000 linhas
- [ ] Joins feitos na query (select com relações), não em N+1 no cliente
- [ ] Listas têm paginação server-side (não filtro no cliente)
- [ ] Relatórios pesados usam view materializada ou RPC dedicada

**Bundle**
- [ ] Todas as rotas têm `React.lazy()` + `<Suspense>`
- [ ] Bibliotecas pesadas (charts, editor) têm lazy loading por componente
- [ ] Nenhuma biblioteca duplicada (`npm ls <lib>` ou bundle visualizer)

**React**
- [ ] Componentes em listas têm `memo()` se o pai re-renderiza com frequência
- [ ] Não há `useEffect` com dep array vazio fazendo fetch (usar React Query)
- [ ] Listas com 100+ itens têm virtualização ou paginação
- [ ] `staleTime` configurado adequadamente por tipo de dado

**Cache**
- [ ] QueryClient tem `staleTime` e `gcTime` configurados globalmente
- [ ] Dados que raramente mudam têm `staleTime` alto (30min+)
- [ ] Mutations fazem `setQueryData` para updates otimistas em ações frequentes
