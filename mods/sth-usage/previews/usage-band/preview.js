const workspace = document.getElementById('workspace');
const metrics = document.getElementById('metrics');
const scenario = document.getElementById('scenario');
const narrow = document.getElementById('narrow-toggle');
const moreToggle = document.getElementById('more-toggle');
const moreMenu = document.getElementById('more-menu');
const pageLabels = { home: 'Home', sth: 'STH', summary: 'Summary', context: 'Context', diagnostics: 'Diagnostics', resume: 'Resume' };
let theme = 'light';
let compact = false;

function renderMetrics() {
  const key = `metrics-${theme}-${scenario.value}-${compact ? 'compact' : 'standard'}`;
  metrics.replaceChildren(document.getElementById(key).content.cloneNode(true));
}

function setMoreOpen(open) {
  moreToggle.setAttribute('aria-expanded', String(open));
  moreToggle.textContent = open ? 'Less ↑' : 'More ↓';
  moreMenu.hidden = !open;
}

function navigate(page, moveFocus = true) {
  if (!Object.hasOwn(pageLabels, page)) return;
  setMoreOpen(false);
  document.querySelectorAll('.page-view').forEach(view => { view.hidden = view.dataset.page !== page; });
  document.getElementById('home-navigation').hidden = page !== 'home';
  document.getElementById('section-navigation').hidden = page === 'home';
  document.getElementById('current-page').textContent = pageLabels[page];
  document.title = `Buddy · ${page === 'home' ? 'Usage' : pageLabels[page]}`;
  if (moveFocus) {
    const heading = document.querySelector(`.page-view[data-page="${page}"] h2`);
    heading.tabIndex = -1;
    heading.focus({ preventScroll: true });
  }
}

function selectSkillTab(tab, moveFocus = false) {
  document.querySelectorAll('[data-skill-tab]').forEach(button => {
    const selected = button.dataset.skillTab === tab;
    button.setAttribute('aria-selected', String(selected));
    button.dataset.variant = selected ? 'default' : 'outline';
    button.tabIndex = selected ? 0 : -1;
    if (selected && moveFocus) button.focus();
  });
  document.getElementById('installed-skills').hidden = tab !== 'installed';
  document.getElementById('catalog-skills').hidden = tab !== 'catalog';
}

document.querySelectorAll('[data-open-page]').forEach(button => {
  button.addEventListener('click', () => navigate(button.dataset.openPage));
});
moreToggle.addEventListener('click', () => setMoreOpen(moreMenu.hidden));
document.addEventListener('click', event => {
  if (!event.target.closest('.more-label')) setMoreOpen(false);
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && !moreMenu.hidden) {
    setMoreOpen(false);
    moreToggle.focus();
  }
});
document.querySelectorAll('[data-skill-tab]').forEach(button => {
  button.addEventListener('click', () => selectSkillTab(button.dataset.skillTab));
  button.addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const nextTab = event.key === 'Home' ? 'installed' : event.key === 'End' ? 'catalog' : button.dataset.skillTab === 'installed' ? 'catalog' : 'installed';
    selectSkillTab(nextTab, true);
  });
});

document.querySelectorAll('[data-theme]').forEach(button => {
  button.addEventListener('click', () => {
    theme = button.dataset.theme;
    workspace.classList.toggle('dark', theme === 'dark');
    document.querySelectorAll('[data-theme]').forEach(option => {
      const selected = option.dataset.theme === theme;
      option.setAttribute('aria-pressed', String(selected));
      option.dataset.variant = selected ? 'default' : 'outline';
    });
    document.getElementById('palette-caption').textContent = theme === 'dark' ? 'Dark palette override' : 'Light palette override';
    renderMetrics();
  });
});
narrow.addEventListener('click', () => {
  compact = !compact;
  narrow.setAttribute('aria-pressed', String(compact));
  narrow.dataset.variant = compact ? 'default' : 'outline';
  workspace.classList.toggle('narrow', compact);
  renderMetrics();
});
scenario.addEventListener('change', renderMetrics);
renderMetrics();
navigate('home', false);
