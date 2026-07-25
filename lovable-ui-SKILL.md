---
name: lovable-ui
description: >
  Camada visual completa para projetos Lovable: componentes shadcn/ui, Tailwind CSS, formulários
  React Hook Form + Zod, tabelas TanStack Table, design tokens, dark mode, responsividade,
  acessibilidade e padrões de UX para estados de loading/error/empty. Use esta skill para TUDO
  que o usuário vê: criar páginas, formulários, tabelas, modais, cards, dashboards, sidebars,
  toasts, e qualquer componente visual. Não define lógica de dados (→ lovable-data), não define
  arquitetura de hooks (→ lovable-core), não toca segurança (→ lovable-security).
  Ativada pelo lovable-architect sempre que a tarefa envolve interface visual.
---

# Lovable UI — Interface Visual & Design System

**Responsabilidade exclusiva:** O que o usuário vê e interage. Componentes, layout, formulários,
tabelas, estados visuais, dark mode e acessibilidade. Consome dados de hooks (lovable-core/data),
nunca faz fetch diretamente.

---

## Lei dos Componentes UI

```
❌ Nunca editar  src/components/ui/  — são primitivos do shadcn/ui
✅ Sempre estender via props, className ou wrapper
✅ Compor primitivos shadcn em componentes de domínio
✅ Usar cn() do @/lib/utils para classes condicionais
✅ Tokens semânticos: text-foreground, bg-background, text-muted-foreground
❌ Cores hardcoded: text-gray-500, bg-zinc-900 (sem razão semântica)
❌ Valores arbitrários sem necessidade: w-[347px], mt-[13px]
```

---

## Sistema de Design Tokens (Tailwind → shadcn)

```
Texto principal    → text-foreground
Texto secundário   → text-muted-foreground
Fundo da página    → bg-background
Fundo de card      → bg-card
Bordas             → border-border
Interativo primário→ bg-primary text-primary-foreground
Destrutivo         → bg-destructive text-destructive-foreground
Sucesso (custom)   → bg-emerald-600 dark:bg-emerald-500 (sem token padrão)
Aviso              → bg-amber-500
Info               → bg-blue-500
```

---

## Formulários — Padrão Canônico

Todo formulário usa React Hook Form + Zod + shadcn Form components.

```typescript
// components/[feature]/[Entity]Form.tsx
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  Form, FormControl, FormDescription, FormField, FormItem,
  FormLabel, FormMessage,
} from '@/components/ui/form';

// 1. Schema Zod (pode estar em lib/validators.ts se compartilhado)
const productSchema = z.object({
  name:        z.string().min(2, 'Mínimo 2 caracteres').max(200, 'Máximo 200 caracteres'),
  price:       z.coerce.number().min(0, 'Preço não pode ser negativo'),
  status:      z.enum(['draft', 'published', 'archived'], { required_error: 'Selecione um status' }),
  description: z.string().max(2000).optional(),
  category_id: z.string().uuid('Selecione uma categoria'),
});

type ProductFormValues = z.infer<typeof productSchema>;

// 2. Props do formulário
interface ProductFormProps {
  onSubmit:      (values: ProductFormValues) => Promise<void>;
  defaultValues?: Partial<ProductFormValues>;
  isLoading?:    boolean;
}

// 3. Componente de formulário
export const ProductForm = ({ onSubmit, defaultValues, isLoading }: ProductFormProps) => {
  const form = useForm<ProductFormValues>({
    resolver: zodResolver(productSchema),
    defaultValues: {
      name: '', price: 0, status: 'draft', description: '', ...defaultValues,
    },
  });

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">

        {/* Campo de texto */}
        <FormField control={form.control} name="name" render={({ field }) => (
          <FormItem>
            <FormLabel>Nome do produto</FormLabel>
            <FormControl>
              <Input placeholder="Ex: Camiseta Premium" {...field} />
            </FormControl>
            <FormDescription>Nome exibido na loja.</FormDescription>
            <FormMessage /> {/* ← erro do Zod aparece aqui automaticamente */}
          </FormItem>
        )} />

        {/* Campo numérico */}
        <FormField control={form.control} name="price" render={({ field }) => (
          <FormItem>
            <FormLabel>Preço (R$)</FormLabel>
            <FormControl>
              <Input type="number" step="0.01" min="0" placeholder="0,00" {...field} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )} />

        {/* Select */}
        <FormField control={form.control} name="status" render={({ field }) => (
          <FormItem>
            <FormLabel>Status</FormLabel>
            <Select onValueChange={field.onChange} defaultValue={field.value}>
              <FormControl>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione..." />
                </SelectTrigger>
              </FormControl>
              <SelectContent>
                <SelectItem value="draft">Rascunho</SelectItem>
                <SelectItem value="published">Publicado</SelectItem>
                <SelectItem value="archived">Arquivado</SelectItem>
              </SelectContent>
            </Select>
            <FormMessage />
          </FormItem>
        )} />

        {/* Textarea */}
        <FormField control={form.control} name="description" render={({ field }) => (
          <FormItem>
            <FormLabel>Descrição <span className="text-muted-foreground">(opcional)</span></FormLabel>
            <FormControl>
              <Textarea
                placeholder="Descreva o produto..."
                className="resize-none"
                rows={4}
                {...field}
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )} />

        <Button type="submit" disabled={isLoading} className="w-full">
          {isLoading
            ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Salvando...</>
            : 'Salvar produto'
          }
        </Button>
      </form>
    </Form>
  );
};
```

### Resetar formulário ao carregar dados (modo edição)

```typescript
// No hook que usa o formulário (lovable-core define o hook, lovable-ui define o form)
const { data: product } = useProduct(productId);

useEffect(() => {
  if (product) {
    form.reset({
      name:        product.name,
      price:       Number(product.price),
      status:      product.status,
      description: product.description ?? '',
      category_id: product.category_id,
    });
  }
}, [product]); // form não vai nas deps — é estável
```

---

## Tabelas de Dados — TanStack Table

```typescript
// components/[feature]/[Entity]Table.tsx
import {
  ColumnDef, flexRender, getCoreRowModel, getSortedRowModel,
  getFilteredRowModel, getPaginationRowModel, useReactTable,
  SortingState, PaginationState,
} from '@tanstack/react-table';

// 1. Definição de colunas (fora do componente — não recriada a cada render)
const columns: ColumnDef<Product>[] = [
  {
    accessorKey: 'name',
    header: ({ column }) => (
      <Button variant="ghost" onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
        className="-ml-4">
        Nome <ArrowUpDown className="ml-2 h-3 w-3" />
      </Button>
    ),
  },
  {
    accessorKey: 'status',
    header: 'Status',
    cell: ({ getValue }) => <StatusBadge status={getValue<Product['status']>()} />,
  },
  {
    accessorKey: 'price',
    header: () => <div className="text-right">Preço</div>,
    cell: ({ getValue }) => (
      <div className="text-right font-medium">
        {formatCurrency(getValue<number>())}
      </div>
    ),
  },
  {
    id: 'actions',
    cell: ({ row }) => <ProductRowActions product={row.original} />,
  },
];

// 2. Componente de tabela genérico e reutilizável
interface DataTableProps<TData> {
  data:               TData[];
  columns:            ColumnDef<TData>[];
  searchPlaceholder?: string;
  isLoading?:         boolean;
  totalCount?:        number;
  onPaginationChange?: (state: PaginationState) => void;
}

export function DataTable<TData>({
  data, columns, searchPlaceholder = 'Buscar...', isLoading, totalCount, onPaginationChange,
}: DataTableProps<TData>) {
  const [sorting,    setSorting]    = useState<SortingState>([]);
  const [globalFilter, setGlobalFilter] = useState('');
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 20 });

  const table = useReactTable({
    data,
    columns,
    manualPagination: !!onPaginationChange,
    rowCount:         totalCount,
    getCoreRowModel:        getCoreRowModel(),
    getSortedRowModel:      getSortedRowModel(),
    getFilteredRowModel:    getFilteredRowModel(),
    getPaginationRowModel:  getPaginationRowModel(),
    onSortingChange:        setSorting,
    onGlobalFilterChange:   setGlobalFilter,
    onPaginationChange:     (updater) => {
      setPagination(updater);
      if (onPaginationChange) {
        const next = typeof updater === 'function' ? updater(pagination) : updater;
        onPaginationChange(next);
      }
    },
    state: { sorting, globalFilter, pagination },
  });

  return (
    <div className="space-y-4">
      <Input
        placeholder={searchPlaceholder}
        value={globalFilter}
        onChange={e => setGlobalFilter(e.target.value)}
        className="max-w-sm"
      />

      <div className="rounded-md border overflow-hidden">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map(hg => (
              <TableRow key={hg.id} className="bg-muted/50">
                {hg.headers.map(h => (
                  <TableHead key={h.id}>
                    {h.isPlaceholder ? null : flexRender(h.column.columnDef.header, h.getContext())}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>
                  {columns.map((_, j) => (
                    <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                  ))}
                </TableRow>
              ))
            ) : table.getRowModel().rows.length ? (
              table.getRowModel().rows.map(row => (
                <TableRow key={row.id} className="hover:bg-muted/30">
                  {row.getVisibleCells().map(cell => (
                    <TableCell key={cell.id}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={columns.length} className="h-32 text-center text-muted-foreground">
                  Nenhum resultado encontrado.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {/* Paginação */}
      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>
          {totalCount != null
            ? `${totalCount} registros`
            : `${table.getFilteredRowModel().rows.length} resultados`}
        </span>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm"
            onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()}>
            Anterior
          </Button>
          <span>Página {table.getState().pagination.pageIndex + 1} de {table.getPageCount()}</span>
          <Button variant="outline" size="sm"
            onClick={() => table.nextPage()} disabled={!table.getCanNextPage()}>
            Próxima
          </Button>
        </div>
      </div>
    </div>
  );
}
```

---

## Estados Visuais — Padrão Completo

Todo componente que carrega dados deve tratar os 4 estados:

```typescript
// Componente de lista — padrão completo
export const ProductList = ({ categoryId }: { categoryId: string }) => {
  const { data, isLoading, error, refetch } = useProducts({ categoryId });

  // Loading: skeletons que preservam o layout
  if (isLoading) return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {Array.from({ length: 6 }).map((_, i) => (
        <Skeleton key={i} className="h-48 rounded-xl" />
      ))}
    </div>
  );

  // Error: com possibilidade de retry
  if (error) return (
    <div className="flex flex-col items-center justify-center py-16 text-center gap-3">
      <AlertCircle className="h-10 w-10 text-destructive" />
      <div>
        <p className="font-medium text-foreground">Falha ao carregar produtos</p>
        <p className="text-sm text-muted-foreground mt-1">{error.message}</p>
      </div>
      <Button variant="outline" size="sm" onClick={() => refetch()}>
        <RefreshCw className="mr-2 h-4 w-4" /> Tentar novamente
      </Button>
    </div>
  );

  // Empty: CTA contextual, não apenas "nenhum resultado"
  if (!data?.data.length) return (
    <div className="flex flex-col items-center justify-center py-16 text-center gap-4 
      border-2 border-dashed border-border rounded-xl">
      <div className="p-4 bg-muted rounded-full">
        <Package className="h-8 w-8 text-muted-foreground" />
      </div>
      <div>
        <p className="font-semibold text-foreground">Nenhum produto ainda</p>
        <p className="text-sm text-muted-foreground mt-1">
          Comece adicionando seu primeiro produto à loja.
        </p>
      </div>
      <Button>
        <Plus className="mr-2 h-4 w-4" /> Adicionar produto
      </Button>
    </div>
  );

  // Data: renderização principal
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {data.data.map(product => (
        <ProductCard key={product.id} product={product} />
      ))}
    </div>
  );
};
```

---

## Modais e Sheets — Padrão Controlado

```typescript
// components/shared/ConfirmDialog.tsx
interface ConfirmDialogProps {
  open:           boolean;
  onOpenChange:   (open: boolean) => void;
  title:          string;
  description:    string;
  confirmLabel?:  string;
  variant?:       'default' | 'destructive';
  onConfirm:      () => Promise<void>;
}

export const ConfirmDialog = ({
  open, onOpenChange, title, description,
  confirmLabel = 'Confirmar', variant = 'default', onConfirm,
}: ConfirmDialogProps) => {
  const [isPending, setIsPending] = useState(false);

  const handleConfirm = async () => {
    setIsPending(true);
    try {
      await onConfirm();
      onOpenChange(false);
    } catch {
      // erro já tratado no mutation
    } finally {
      setIsPending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>
            Cancelar
          </Button>
          <Button variant={variant} onClick={handleConfirm} disabled={isPending}>
            {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
```

---

## Componentes Utilitários Reutilizáveis

### StatusBadge com CVA

```typescript
import { cva, type VariantProps } from 'class-variance-authority';

const statusVariants = cva(
  'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium',
  {
    variants: {
      status: {
        active:    'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400',
        inactive:  'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
        pending:   'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400',
        error:     'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400',
        draft:     'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400',
        published: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400',
        archived:  'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-500',
      },
    },
    defaultVariants: { status: 'inactive' },
  }
);

const STATUS_DOT = 'h-1.5 w-1.5 rounded-full bg-current';

const STATUS_LABELS: Record<string, string> = {
  active: 'Ativo', inactive: 'Inativo', pending: 'Pendente',
  error: 'Erro', draft: 'Rascunho', published: 'Publicado', archived: 'Arquivado',
};

interface StatusBadgeProps extends VariantProps<typeof statusVariants> {
  label?: string;
  className?: string;
}

export const StatusBadge = ({ status, label, className }: StatusBadgeProps) => (
  <span className={cn(statusVariants({ status }), className)}>
    <span className={STATUS_DOT} />
    {label ?? STATUS_LABELS[status ?? 'inactive'] ?? status}
  </span>
);
```

### PageHeader

```typescript
interface PageHeaderProps {
  title:       string;
  description?: string;
  action?:     ReactNode;
  breadcrumb?: { label: string; href?: string }[];
}

export const PageHeader = ({ title, description, action, breadcrumb }: PageHeaderProps) => (
  <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between mb-6">
    <div className="space-y-1">
      {breadcrumb && (
        <nav className="flex items-center gap-1 text-xs text-muted-foreground mb-1">
          {breadcrumb.map((item, i) => (
            <Fragment key={i}>
              {i > 0 && <ChevronRight className="h-3 w-3" />}
              {item.href
                ? <Link to={item.href} className="hover:text-foreground transition-colors">{item.label}</Link>
                : <span>{item.label}</span>}
            </Fragment>
          ))}
        </nav>
      )}
      <h1 className="text-2xl font-bold tracking-tight text-foreground">{title}</h1>
      {description && <p className="text-sm text-muted-foreground">{description}</p>}
    </div>
    {action && <div className="shrink-0 mt-2 sm:mt-0">{action}</div>}
  </div>
);
```

---

## Layout de Página — Padrão SaaS

```typescript
// pages/ProductsPage.tsx
export default function ProductsPage() {
  const [isCreateOpen, setIsCreateOpen] = useState(false);

  return (
    <div className="container mx-auto py-6 px-4 max-w-7xl">
      <PageHeader
        title="Produtos"
        description="Gerencie o catálogo da sua loja."
        breadcrumb={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Produtos' }]}
        action={
          <Button onClick={() => setIsCreateOpen(true)}>
            <Plus className="mr-2 h-4 w-4" /> Novo produto
          </Button>
        }
      />

      <ProductList />

      <Sheet open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <SheetContent className="sm:max-w-lg overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Novo produto</SheetTitle>
            <SheetDescription>Preencha os dados para criar um produto.</SheetDescription>
          </SheetHeader>
          <div className="mt-6">
            <CreateProductForm onSuccess={() => setIsCreateOpen(false)} />
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
```

---

## Acessibilidade — Regras Mínimas

```
✅ Botões icônicos têm aria-label: <Button aria-label="Deletar produto">
✅ Inputs têm label associada via htmlFor / FormLabel
✅ Imagens têm alt descritivo (ou alt="" se decorativas)
✅ Diálogos têm DialogTitle e DialogDescription
✅ Cores não são o único indicador (usar ícone + texto junto)
✅ Foco visível: não remover outline sem alternativa
✅ Contraste mínimo: 4.5:1 para texto, 3:1 para UI
✅ Tecla Escape fecha modais (shadcn já implementa)
```

---

## Checklist de Qualidade — UI

- [ ] Formulários usam React Hook Form + Zod (sem estado manual)
- [ ] Todos os campos têm `FormLabel` e `FormMessage` para erros
- [ ] Os 4 estados estão tratados: loading, error, empty, data
- [ ] Skeletons preservam o layout real (mesmas dimensões)
- [ ] Cores usam tokens semânticos (não hardcoded)
- [ ] Dark mode funciona sem código adicional
- [ ] Layout responsivo de 320px até 1440px+
- [ ] Botões destrutivos (deletar) têm ConfirmDialog
- [ ] Ações em listas têm feedback de loading (disabled + spinner)
- [ ] Formulários em modais/sheets usam o componente correto (Dialog pequeno, Sheet grande)
