export function PageHeading({ title, description }: { title: string; description: string }) {
  return (
    <header className="border-b pb-4">
      <h1 className="text-xl leading-8 font-semibold tracking-[-0.01em]">{title}</h1>
      <p className="text-muted-foreground mt-1 max-w-2xl text-sm leading-6">{description}</p>
    </header>
  );
}
