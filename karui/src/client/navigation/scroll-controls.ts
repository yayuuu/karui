export function initScrollControls() {
  const currentPage = () => document.querySelector<HTMLElement>('#page');
  const topButton = document.querySelector<HTMLButtonElement>('.topbutton');
  const updateScrollButton = () => { if (topButton) topButton.hidden = Math.max(currentPage()?.scrollTop ?? 0, window.scrollY) < 100; };
  document.addEventListener('scroll', updateScrollButton, { passive: true, capture: true });
  window.addEventListener('scroll', updateScrollButton, { passive: true });
  window.addEventListener('resize', updateScrollButton);
  topButton?.addEventListener('click', () => {
    const options: ScrollToOptions = { top: 0, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' };
    currentPage()?.scrollTo(options); window.scrollTo(options);
  });
  return updateScrollButton;
}
