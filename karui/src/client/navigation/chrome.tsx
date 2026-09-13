import { createIsland } from '../ui/island.js';
import { t } from '../i18n.js';

type Failure = { href: string; retry: () => void };

type State = { back: string; message: string; failure?: Failure };

function NavigationChrome({ back, message, failure }: State) {
  return <>
    <div class="navigation-notice" role="status" hidden={!failure}>
      {failure && <>
        {t('The page could not be loaded.')}{' '}
        <button type="button" onClick={failure.retry}>{t('Try again')}</button>
        <a href={failure.href} data-full-navigation="">{t('Open the full page')}</a>
      </>}
    </div>
    <div class="visually-hidden" role="status">{message}</div>
    {back && <a href={back} class="navibutton backbutton" title={t('Back')} aria-label={t('Back')}>◄</a>}
  </>;
}

export function createNavigationChrome() {
  const original = document.querySelector<HTMLAnchorElement>('.backbutton');
  const state: State = { back: original?.getAttribute('href') ?? '', message: '' };
  const island = createIsland('navigation');
  const update = (patch: Partial<State>) => {
    Object.assign(state, patch);
    island.render(<NavigationChrome {...state} />);
  };
  original?.remove();
  update({});
  return {
    loading: () => update({ failure: undefined, message: t('Loading page…') }),
    announce: (message: string) => update({ message }),
    setBack: (href: string) => update({ back: /^\/(?!\/)/.test(href) ? href : '' }),
    fail: (href: string, retry: () => void) => update({ failure: { href, retry }, message: '' }),
  };
}
