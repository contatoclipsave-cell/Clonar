---
name: lovable-quality
description: >
  Qualidade de código para projetos Lovable: debugging sistemático, code review, refactoring seguro
  e prevenção de regressões. Use esta skill para: diagnosticar bugs (TypeScript, React, Supabase,
  formulários), revisar código antes de merge/deploy, refatorar código legado ou difícil de manter,
  identificar code smells e antipadrões, e verificar que uma correção não introduziu novos problemas.
  Ativada pelo lovable-architect em tarefas de Bug e Refactor, e como etapa final de revisão em
  tarefas L e XL. Atua como revisor sênior e investigador: nunca assume, sempre verifica a causa raiz.
---

# Lovable Quality — Debugging, Review e Refactoring

**Responsabilidade exclusiva:** Qualidade do código — detectar, corrigir e prevenir problemas.
Não cria features novas, não define schema, não constrói UI. Opera sobre código existente.

---

## Protocolo de Debugging (5 Camadas)

Nunca pule etapas. Cada camada só é descartada quando verificada, não assumida.

```
Camada 1: OBSERVAR   — Qual é o comportamento exato? Reproduzir de forma determinística.
Camada 2: LOCALIZAR  — Em qual camada está? DB → Edge Fn → Hook → Component → UI
Camada 3: HIPÓTESE   — Qual a causa mais provável com base nos sintomas?
Camada 4: VERIFICAR  — Confirmar a hipótese com o mínimo de mudança possível.
Camada 5: CORRIGIR   — Aplicar correção na causa raiz + checar se criou novos problemas.
```

---

## Categoria A — Erros TypeScript

### `Property 'X' does not exist on type 'Y'`

```typescript
// Diagnóstico: o tipo não tem a propriedade que você acessa
// Causa 1: dado não tipado
const user = data as any; // ← any perde o tipo
user.profile.name;        // TypeScript não sabe se profile existe

// ✅ Correção: tipar na fonte, não no ponto de uso
import type { Database } from '@/integrations/supabase/types';
type User = Database['public']['Tables']['profiles']['Row'];
const user: User = data; // TypeScript sabe a estrutura exata

// Causa 2: join Supabase não tipado
const { data } = await supabase.from('products').select('*, categories(*)');
// data tem tipo Product[] mas categories não está no tipo base

// ✅ Correção: usar tipo derivado do select
type ProductWithCategory = Database['public']['Tables']['products']['Row'] & {
  categories: Database['public']['Tables']['categories']['Row'] | null;
};
```

### `Type 'X | undefined' is not assignable to type 'X'`

```typescript
// Causa: dado pode ser null/undefined mas código assume que não é
const { data: product } = useProduct(id);
return <h1>{product.name}</h1>; // ← product pode ser undefined

// ✅ Correção: early return (melhor — limpo e TypeScript fica feliz)
if (!product) return null;
return <h1>{product.name}</h1>;

// ✅ Alternativa: optional chaining + fallback
return <h1>{product?.name ?? 'Sem nome'}</h1>;

// ❌ Não usar non-null assertion sem certeza absoluta
return <h1>{product!.name}</h1>; // silencia TS mas explode em runtime se undefined
```

### Erro de Tipo em Mutation

```typescript
// Causa: tipo de input não bate com o que a mutation espera
// ❌ Passando objeto parcial onde o completo é esperado
const partialData = { name: 'Produto' };
createMutation.mutate(partialData); // ProductInsert precisa de user_id, status...

// ✅ Deixar TypeScript guiar — o erro de tipo mostra o que falta
const fullData: ProductInsert = {
  name:     'Produto',
  status:   'draft',
  user_id:  user.id,   // ← TypeScript pede isso
  price:    0,
};
createMutation.mutate(fullData);
```

---

## Categoria B — Bugs de React State

### Loop Infinito em useEffect

```typescript
// Sintoma: página trava ou fica re-renderizando
// Causa 1: objeto/função no array de deps (nova referência a cada render)
useEffect(() => {
  fetchData(options);
}, [options]); // options = { page: 1 } — novo objeto a cada render

// ✅ Correção 1: desestruturar primitivos
const { page, limit } = options;
useEffect(() => {
  fetchData({ page, limit });
}, [page, limit]); // primitivos têm comparação por valor

// ✅ Correção 2: memoizar o objeto
const stableOptions = useMemo(() => options, [options.page, options.limit]);
useEffect(() => { fetchData(stableOptions); }, [stableOptions]);

// Causa 2: setState dentro do effect sem guard
useEffect(() => {
  if (data) setLocalData(data); // ← setLocalData causa re-render → effect roda → loop
}, [data, setLocalData]); // setLocalData nunca foi estável

// ✅ Correção: usar dado diretamente ou usar useCallback
const handleData = useCallback((d: Data) => setLocalData(d), []); // [] = estável
useEffect(() => { if (data) handleData(data); }, [data, handleData]);
```

### Closure Stale (State Desatualizado)

```typescript
// Sintoma: timer ou callback mostra valor antigo
const [count, setCount] = useState(0);
useEffect(() => {
  const id = setInterval(() => {
    setCount(count + 1); // ← count é 0 para sempre (closure)
  }, 1000);
  return () => clearInterval(id);
}, []); // ← [] captura count=0 e não atualiza

// ✅ Correção: functional update
setCount(prev => prev + 1); // prev é sempre o atual

// Sintoma: handler usa estado desatualizado
const handleSave = () => {
  console.log(formData); // ← pode ser stale se recriado sem useCallback correto
};
// ✅ Correção: useCallback com deps corretas
const handleSave = useCallback(() => {
  console.log(formData);
}, [formData]); // formData nas deps
```

### Re-render Excessivo

```typescript
// Diagnóstico: adicionar e remover após identificar
const renders = useRef(0);
renders.current++;
console.log(`[${displayName}] render #${renders.current}`);

// Causa 1: Context re-renderizando toda a árvore
// Diagnóstico: quem muda no context está causando re-render de quem só lê outras partes?
// ✅ Correção: separar context em partes — authContext e themeContext independentes

// Causa 2: Prop de objeto inline
<ChildComponent style={{ color: 'red' }} /> // novo objeto a cada render do pai
// ✅ Correção:
const childStyle = useMemo(() => ({ color: 'red' }), []);
<ChildComponent style={childStyle} />

// Causa 3: useSelector retornando novo array/objeto a cada chamada
// (Zustand ou selector de Context)
const items = useStore(state => state.items.filter(Boolean)); // novo array sempre
// ✅ Correção: memoizar o selector ou usar shallow comparison
```

---

## Categoria C — Bugs Supabase

### RLS Bloqueando Inesperadamente

```sql
-- Diagnóstico 1: simular o usuário no SQL Editor
SET LOCAL role TO authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub": "uuid-do-usuario"}';

-- Testar a query
SELECT * FROM public.products; -- deve retornar dados se RLS está correta

-- Diagnóstico 2: listar policies da tabela
SELECT policyname, cmd, qual, with_check
FROM pg_policies
WHERE tablename = 'products';

-- Diagnóstico 3: verificar se RLS está habilitado
SELECT tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public';
```

```typescript
// Diagnóstico no cliente: garantir que há sessão
const { data: { session } } = await supabase.auth.getSession();
console.log('user.id:', session?.user?.id);
// Deve ser o mesmo que user_id na tabela
```

### `PGRST116` — Nenhuma Linha Retornada

```typescript
// ❌ .single() lança erro se 0 ou 2+ linhas
const { data, error } = await supabase.from('profiles').eq('id', id).single();
// error: PGRST116 se não houver perfil

// ✅ .maybeSingle() retorna null sem erro se não encontrar
const { data, error } = await supabase.from('profiles').eq('id', id).maybeSingle();
if (!data) {
  // Criar perfil, redirecionar ou retornar null — decisão do domínio
}
```

### Mutation Não Atualiza a UI

```typescript
// Causa: queryKey na invalidação não bate com o da query
// useProducts: queryKey: ['products', { status, categoryId }]
onSuccess: () => {
  queryClient.invalidateQueries({ queryKey: ['product'] }); // ❌ singular, sem filtros
}

// ✅ Usar prefix — invalida tudo que começa com 'products'
queryClient.invalidateQueries({ queryKey: ['products'] });

// ✅ Ou invalidação exata
queryClient.invalidateQueries({
  queryKey: ['products', { status: currentStatus, categoryId }],
  exact: true,
});

// ✅ Debug: ReactQueryDevtools mostra o cache completo
// Adicionar temporariamente em App.tsx:
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
<ReactQueryDevtools initialIsOpen={false} />
```

### Edge Function Retornando 500

```typescript
// Adicionar logging estruturado para rastrear onde falha
const log = (level: 'info' | 'warn' | 'error', msg: string, data?: unknown) =>
  console.log(JSON.stringify({ level, msg, data, ts: new Date().toISOString() }));

try {
  log('info', 'Request received', { userId: user.id, body });
  const result = await processLogic(body);
  log('info', 'Success', { resultId: result?.id });
  return json(result);
} catch (err) {
  log('error', 'Unhandled exception', {
    message: err instanceof Error ? err.message : String(err),
    stack:   err instanceof Error ? err.stack?.split('\n').slice(0, 5) : undefined,
  });
  return json({ error: 'internal_error' }, 500);
}
// Ver logs: Supabase Dashboard → Edge Functions → [nome] → Logs
```

---

## Categoria D — Bugs de Formulário

### Valores Não Aparecem ao Editar

```typescript
// Causa: form.defaultValues são definidos antes dos dados chegarem
const form = useForm({ defaultValues: { name: '' } }); // vazio no início
const { data } = useProduct(id); // dados chegam depois

// ❌ Não funciona — defaultValues são usados apenas no mount
// ✅ Correção: sincronizar com form.reset() quando dados chegam
useEffect(() => {
  if (data) {
    form.reset({
      name:        data.name,
      status:      data.status,
      category_id: data.category_id,
      price:       Number(data.price),
    });
  }
}, [data]); // form é omitido das deps — é sempre estável
```

### Formulário Não Reseta Após Submit

```typescript
// ✅ Chamar form.reset() no onSuccess da mutation
useMutation({
  mutationFn: createProduct,
  onSuccess: (newProduct) => {
    form.reset();               // limpar formulário
    toast.success('Criado!');
    onClose?.();                // fechar modal se houver
    // opcional: navegar para o produto criado
    navigate(`/products/${newProduct.id}`);
  },
});
```

### Validação Zod Não Dispara

```typescript
// Causa 1: campo de número como string no input
// Input type="number" retorna string; Zod espera number
const schema = z.object({
  price: z.number(), // ← falha se value for "10" (string)
});
// ✅ Correção: z.coerce.number() converte automaticamente
const schema = z.object({
  price: z.coerce.number().min(0),
});

// Causa 2: campo opcional com valor "" (string vazia)
const schema = z.object({
  description: z.string().optional(), // "" não é undefined → passa validação
});
// ✅ Correção: transformar vazio em undefined
const schema = z.object({
  description: z.string().optional().transform(v => v === '' ? undefined : v),
});
```

---

## Code Review — Checklist por Camada

### Antes de finalizar qualquer PR/commit

**TypeScript**
- [ ] Sem `any` — substituído por tipo correto ou `unknown` + guard
- [ ] Tipos de props têm interfaces nomeadas
- [ ] Tipos derivados do Supabase usados onde possível
- [ ] Sem `!` (non-null assertion) sem comentário justificando

**React**
- [ ] Sem `useEffect` para fetch (usar React Query)
- [ ] Sem `useState` + `useEffect` para derivar estado (usar `useMemo`)
- [ ] `useCallback` em handlers passados como props
- [ ] Listas têm `key` com ID estável (não índice)
- [ ] Sem componentes definidos dentro de outros componentes

**Supabase**
- [ ] Sem service_role key em variáveis VITE_*
- [ ] Mutations invalidam o queryKey correto
- [ ] `.maybeSingle()` onde 0 linhas é válido

**Qualidade Geral**
- [ ] Sem `console.log` de debug deixado no código
- [ ] Sem código comentado (usar git history)
- [ ] Sem TODOs sem issue associada
- [ ] Funções com mais de 30 linhas têm nome descritivo (não `handleStuff`)
- [ ] Imports organizados: externos → internos → tipos

---

## Refactoring — Quando e Como

### Sinais de que precisa refatorar

```
1. Componente > 200 linhas              → dividir por responsabilidade
2. Hook > 100 linhas                    → extrair sub-hooks
3. Mesmo bloco de código em 3+ lugares  → extrair função/hook/componente
4. Props drilling > 2 níveis            → considerar Context ou composição
5. useEffect com > 3 dependências       → lógica complexa demais para um effect
6. Tipo `any` com comentário "corrigir" → corrigir agora
```

### Refactoring Seguro

```
1. Escrever o comportamento atual em palavras (teste mental)
2. Fazer UMA mudança por vez
3. Verificar que o comportamento não mudou após cada passo
4. Nunca refatorar e adicionar feature no mesmo commit
```

```typescript
// Exemplo: extrair lógica de um componente grande

// ❌ Antes: tudo junto
const ProductPage = () => {
  const [products, setProducts] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [filter, setFilter] = useState('all');
  // 150 linhas de lógica...
  return <div>...</div>;
};

// ✅ Depois: Passo 1 — extrair estado em hook
const useProductPage = () => {
  const [filter, setFilter] = useState('all');
  const { data: products, isLoading } = useProducts({ status: filter !== 'all' ? filter : undefined });
  return { products, isLoading, filter, setFilter };
};

// ✅ Passo 2 — componente limpo
const ProductPage = () => {
  const { products, isLoading, filter, setFilter } = useProductPage();
  return <div>...</div>; // só JSX
};
```

---

## Mapa de Diagnóstico Rápido

```
Erro de tipo TypeScript?
├── "does not exist on type" → tipar na fonte (Supabase types ou interface)
├── "is not assignable"      → verificar null/undefined ou converter tipo
└── "Object possibly undefined" → early return ou optional chaining

UI não atualiza após mutation?
├── Verificar queryKey em invalidateQueries (deve ser prefix da query)
├── Verificar se a mutation está sendo chamada (console.log no mutationFn)
└── ReactQueryDevtools: ver cache após a mutation

useEffect em loop?
├── Deps com objeto/array → usar primitivos ou useMemo
├── Deps com função → usar useCallback com deps corretas
└── setState dentro do effect → garantir que tem guard (if (!alreadySet))

Formulário com problema?
├── Valores não carregam → useEffect + form.reset() quando data chegar
├── Não reseta após submit → form.reset() no onSuccess
└── Validação não dispara → z.coerce para números, verificar schema

RLS bloqueando?
├── Testar no SQL Editor com SET LOCAL role TO authenticated
├── Verificar que user_id na tabela = auth.uid()
└── Listar policies: SELECT * FROM pg_policies WHERE tablename = '...'
```
