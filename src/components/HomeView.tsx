import FileText from "lucide-react/dist/esm/icons/file-text.mjs";
import Star from "lucide-react/dist/esm/icons/star.mjs";
import { Page } from "../lib/db";
import { favoritePages, recentPages } from "../lib/homeSections";
import { useT } from "../lib/i18n";

function PageList({
  pages,
  onSelectPage,
}: {
  pages: Page[];
  onSelectPage: (id: string) => void;
}) {
  const t = useT();

  if (pages.length === 0) {
    return <div className="text-sm text-muted-foreground">{t('home.noPagesYet')}</div>;
  }

  return (
    <div className="space-y-1">
      {pages.map((page) => (
        <button
          key={page.id}
          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-foreground/80 hover:bg-muted hover:text-foreground"
          onClick={() => onSelectPage(page.id)}
        >
          {page.icon ? (
            <span className="flex h-5 w-5 items-center justify-center text-sm">{page.icon}</span>
          ) : (
            <FileText className="h-4 w-4 text-muted-foreground" />
          )}
          <span className="truncate">{page.title || t('home.untitled')}</span>
        </button>
      ))}
    </div>
  );
}

export function HomeView({
  pages,
  onSelectPage,
}: {
  pages: Page[];
  onSelectPage: (id: string) => void;
}) {
  const t = useT();
  const recent = recentPages(pages);
  const favorites = favoritePages(pages);

  return (
    <div className="on-scroll-fade h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl px-10 py-24">
        <div className="mb-10 flex items-center justify-between gap-4">
          <div>
            <h1 className="text-4xl font-bold tracking-normal text-foreground">{t('home.title')}</h1>
            <p className="mt-2 text-sm text-muted-foreground">{t('home.subtitle')}</p>
          </div>
        </div>

        <div className="grid gap-8 md:grid-cols-2">
          <section>
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('home.recentPages')}</div>
            <PageList pages={recent} onSelectPage={onSelectPage} />
          </section>

          <section>
            <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <Star className="h-3.5 w-3.5" />
              {t('home.favorites')}
            </div>
            {favorites.length === 0 ? (
              <div className="text-sm text-muted-foreground">{t('home.noFavoritesYet')}</div>
            ) : (
              <PageList pages={favorites} onSelectPage={onSelectPage} />
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
