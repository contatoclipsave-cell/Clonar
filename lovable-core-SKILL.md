---
name: lovable-core
description: >
  Arquitetura React/TypeScript pura para projetos Lovable — sem sobreposição com UI ou dados.
  Use esta skill para: estrutura de componentes, custom hooks, Context, rotas React Router,
  tipagem TypeScript avançada, gerenciamento de estado (local, global, derivado), composição de
  componentes, lazy loading, error boundaries, e qualquer decisão arquitetural de código frontend.
  É ativada pelo lovable-architect para tarefas de Feature, Refactor e qualquer tarefa que exija
  decisão sobre como organizar o código React. Não cobre UI visual (→ lovable-ui) nem dados (→ lovable-data).
---

# Lovable Core — Arquitetura React/TypeScript

**Responsabilidade exclusiva:** Como o código é estruturado — não o que ele parece, não de onde
vêm os dados. Foca em: componentes, hooks, estado, rotas, tipagem e composição.

---

## Estrutura de Componente Canônica

Todo componente segue esta anatomia em ordem:

```typescript
// 1. Imports (externos → internos → tipos)
import { useState, useCallback, memo } from 'react';
import { useNavigate } from 'react-router-dom';
import { ProductCard } from '@/components/products/ProductCard';
import { useProducts } from '@/hooks/products/use-products';
import type { Product } from '@/types/product.types';

// 2. Interface de props (sempre nomeada, nunca inline anônima)
interface ProductListProps {
  categoryId: string;
  onSelect?: (product: Product) => void;
  className?: string;
}

// 3. Componente (arrow function, export const)
export const ProductList = memo(({ categoryId, onSelect, className }: ProductListProps) => {
  // 3a. Hooks de estado (useState primeiro)
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // 3b. Hooks de dados e navegação
  const { data: products, isLoading, error } = useProducts(categoryId);
  const navigate = useNavigate();

  // 3c. Handlers memoizados (useCallback para props ou eventos frequentes)
  const handleSelect = useCallback((product: Product) => {
    setSelectedId(product.id);
    onSelect?.(product);
  }, [onSelect]);

  // 3d. Derived state (useMemo para cálculos custosos)
  const activeProducts = useMemo(
    () => products?.filter(p => p.status === 'active') ?? [],
    [products]
  );

  // 3e. Early returns para estados especiais
  if (isLoading) return <ProductListSkeleton />;
  if (error) return <ErrorState message={error.message} />;
  if (!activeProducts.length) return <EmptyState entity="produtos" />;

  // 3f. JSX principal (limpo, sem lógica)
  return (
    <div className={cn('grid gap-4', className)}>
      {activeProducts.map(product => (
        <ProductCard
          key={product.id}
          product={product}
          isSelected={selectedId === product.id}
          onSelect={handleSelect}
        />
      ))}
    </div>
  );
});

ProductList.displayName = 'ProductList';
```

### Regras de Componente
- Máximo 150 linhas (UI simples) ou 200 linhas (com lógica complexa) — dividir se ultrapassar
- `memo()` quando o componente é filho de lista ou recebe muitas props de pai que re-renderiza
- `export default` apenas em páginas; todos os outros usam `export const`
- `displayName` sempre que usar `memo()` ou `forwardRef()`

---

## Custom Hooks — Padrões

### Hook de Lógica de UI (sem dados do servidor)

```typescript
// hooks/use-disclosure.ts — exemplo de hook de estado puro
interface UseDisclosureOptions {
  defaultOpen?: boolean;
  onOpen?: () => void;
  onClose?: () => void;
}

export const useDisclosure = (options: UseDisclosureOptions = {}) => {
  const { defaultOpen = false, onOpen, onClose } = options;
  const [isOpen, setIsOpen] = useState(defaultOpen);

  const open = useCallback(() => {
    setIsOpen(true);
    onOpen?.();
  }, [onOpen]);

  const close = useCallback(() => {
    setIsOpen(false);
    onClose?.();
  }, [onClose]);

  const toggle = useCallback(() => {
    setIsOpen(prev => {
      const next = !prev;
      if (next) onOpen?.(); else onClose?.();
      return next;
    });
  }, [onOpen, onClose]);

  return { isOpen, open, close, toggle };
};
```

### Hook de Formulário com Mutation (bridge entre ui e data)

```typescript
// hooks/products/use-product-form.ts
export const useProductForm = (productId?: string) => {
  const { data: product } = useProduct(productId); // do lovable-data
  const createMutation = useCreateProduct();
  const updateMutation = useUpdateProduct();

  const form = useForm<ProductFormValues>({
    resolver: zodResolver(productSchema),
    defaultValues: { name: '', status: 'draft', price: 0 },
  });

  // Sincronizar com dados carregados (modo edição)
  useEffect(() => {
    if (product) {
      form.reset({
        name: product.name,
        status: product.status,
        price: Number(product.price),
      });
    }
  }, [product, form]);

  const onSubmit = useCallback(async (values: ProductFormValues) => {
    if (productId) {
      await updateMutation.mutateAsync({ id: productId, ...values });
    } else {
      await createMutation.mutateAsync(values);
    }
  }, [productId, createMutation, updateMutation]);

  return {
    form,
    onSubmit,
    isLoading: createMutation.isPending || updateMutation.isPending,
    isEditing: !!productId,
  };
};
```

---

## Tipagem TypeScript — Padrões Avançados

```typescript
// Discriminated Union para estados de máquina
type PaymentState =
  | { status: 'idle' }
  | { status: 'processing'; transactionId: string }
  | { status: 'succeeded'; receipt: Receipt }
  | { status: 'failed'; error: string; retryable: boolean };

// Generic para operações assíncronas
type AsyncResult<T> =
  | { status: 'loading' }
  | { status: 'success'; data: T }
  | { status: 'error'; message: string };

// Branded types para IDs (previne misturar userId com productId)
type UserId = string & { readonly _brand: 'UserId' };
type ProductId = string & { readonly _brand: 'ProductId' };

const toUserId = (id: string): UserId => id as UserId;
const toProductId = (id: string): ProductId => id as ProductId;

// Tipos derivados do Supabase (fonte única da verdade)
import type { Database } from '@/integrations/supabase/types';

type Tables = Database['public']['Tables'];
export type Product = Tables['products']['Row'];
export type ProductInsert = Tables['products']['Insert'];
export type ProductUpdate = Tables['products']['Update'];

// Tipo parcial para filtros
type ProductFilters = Partial<Pick<Product, 'status' | 'category_id'>>;
```

---

## Gerenciamento de Estado — Hierarquia Decisória

```
Dado vem do banco?          → TanStack Query (lovable-data define o hook)
Estado UI de 1 componente?  → useState local
Estado UI de 2-3 componentes próximos? → prop drilling aceitável até 2 níveis
Estado UI compartilhado entre rotas? → Context + useReducer
Estado complexo (undo/redo, offline)? → Zustand
```

### Context Padrão (Auth)

```typescript
// contexts/auth-context.tsx
interface AuthContextValue {
  user: User | null;
  profile: Profile | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const queryClient = useQueryClient();

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      setIsLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      setUser(session?.user ?? null);
      if (event === 'SIGNED_OUT') {
        queryClient.clear(); // limpar cache ao fazer logout
      }
    });

    return () => subscription.unsubscribe();
  }, [queryClient]);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
  }, []);

  const value = useMemo(() => ({
    user,
    profile: null, // carregado separadamente via TanStack Query
    isLoading,
    isAuthenticated: !!user,
    signOut,
  }), [user, isLoading, signOut]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

// Hook de acesso tipado (nunca acessar o context diretamente)
export const useAuth = (): AuthContextValue => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth deve ser usado dentro de AuthProvider');
  return context;
};
```

---

## Roteamento — React Router v6

```typescript
// src/App.tsx — estrutura de rotas
const App = () => (
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <BrowserRouter>
        <ErrorBoundary FallbackComponent={AppErrorFallback}>
          <Routes>
            {/* Rotas públicas */}
            <Route path="/auth" element={<AuthPage />} />
            <Route path="/auth/callback" element={<AuthCallback />} />

            {/* Rotas protegidas com layout compartilhado */}
            <Route element={<ProtectedRoute />}>
              <Route element={<AppLayout />}>
                <Route index element={<Navigate to="/dashboard" replace />} />
                <Route path="/dashboard" element={
                  <Suspense fallback={<PageSkeleton />}>
                    <DashboardPage />
                  </Suspense>
                } />
                <Route path="/products" element={
                  <Suspense fallback={<PageSkeleton />}>
                    <ProductsPage />
                  </Suspense>
                } />
                <Route path="/products/:id" element={
                  <Suspense fallback={<PageSkeleton />}>
                    <ProductDetailPage />
                  </Suspense>
                } />
              </Route>
            </Route>

            {/* 404 */}
            <Route path="*" element={<NotFoundPage />} />
          </Routes>
        </ErrorBoundary>
      </BrowserRouter>
    </AuthProvider>
  </QueryClientProvider>
);

// ProtectedRoute — guarda de autenticação
const ProtectedRoute = () => {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) return <FullPageSpinner />;
  if (!isAuthenticated) return <Navigate to="/auth" replace />;
  return <Outlet />;
};
```

---

## Error Boundaries

```typescript
// Dois níveis de boundary: App e por rota/feature

// App-level: captura erros críticos
function AppErrorFallback({ error, resetErrorBoundary }: FallbackProps) {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center space-y-4 max-w-md">
        <AlertCircle className="h-12 w-12 text-destructive mx-auto" />
        <h1 className="text-xl font-semibold">Erro inesperado</h1>
        <p className="text-muted-foreground text-sm">{error.message}</p>
        <Button onClick={resetErrorBoundary}>Recarregar</Button>
      </div>
    </div>
  );
}

// Feature-level: captura erros de módulos individuais
function FeatureErrorFallback({ error, resetErrorBoundary }: FallbackProps) {
  return (
    <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-6 text-center">
      <p className="text-sm text-destructive font-medium">Falha ao carregar este módulo</p>
      <Button variant="outline" size="sm" onClick={resetErrorBoundary} className="mt-3">
        Tentar novamente
      </Button>
    </div>
  );
}
```

---

## Checklist de Qualidade — Core

Antes de finalizar qualquer tarefa de arquitetura:

- [ ] Props têm interfaces nomeadas (sem tipos inline anônimos)
- [ ] Sem `any` — usar `unknown` + guard ou tipo derivado do Supabase
- [ ] Handlers em `useCallback` quando passados como props
- [ ] Listas têm `key` com ID estável (nunca índice)
- [ ] Dados do servidor em TanStack Query (nunca em useState + useEffect)
- [ ] Componentes com mais de 150 linhas foram divididos
- [ ] `useEffect` sem `// eslint-disable-next-line` (corrigir as deps, não suprimir)
- [ ] Context não está sendo usado para server state
- [ ] Rotas novas têm lazy loading com Suspense
- [ ] Error boundary cobre a nova feature/rota
