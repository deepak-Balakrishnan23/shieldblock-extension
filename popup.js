// ShieldBlock AI — Popup v2.4

const $ = (id) => document.getElementById(id);
const pwr = $('pwr');
const sbar = $('sbar');
const stxt = $('stxt');
const tot = $('tot');
const cAds = $('cAds');
const cTrk = $('cTrk');
const cSess = $('cSess');
const cAI = $('cAI');
const cML = $('cML');
const cPh = $('cPh');
const hSlider = $('hSlider');
const hVal = $('hVal');
const mSlider = $('mSlider');
const mVal = $('mVal');
const pickBtn = $('pickBtn');
const clrRules = $('clrRules');
const rulesList = $('rulesList');
const tAds = $('tAds');
const tTrk = $('tTrk');
const tPat = $('tPat');
const tPop = $('tPop');
const tYT = $('tYT');
const tMal = $('tMal');
const tAI = $('tAI');
const tML = $('tML');
const tPh = $('tPh');
const tCk = $('tCk');
const alInput = $('alInput');
const alAdd = $('alAdd');
const alList = $('alList');
const rstBtn = $('rstBtn');
const siteTitle = $('siteTitle');
const siteStatus = $('siteStatus');
const siteScore = $('siteScore');
const activityList = $('activityList');

const RULE_COUNTS = {
  ads: 12000,
  trackers: 9000,
  patterns: 8000,
  popups: 1226,
  youtube: 10,
  malware: 48,
};

document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((el) => el.classList.remove('on'));
    document.querySelectorAll('.panel').forEach((panel) => panel.classList.remove('on'));
    tab.classList.add('on');
    $(`panel-${tab.dataset.t}`).classList.add('on');
  });
});

function anim(el, target) {
  const current = parseInt(el.textContent.replace(/,/g, ''), 10) || 0;
  if (current === target) return;
  const diff = target - current;
  const step = Math.sign(diff) * Math.max(1, Math.ceil(Math.abs(diff) / 20));
  let value = current;
  const interval = setInterval(() => {
    value += step;
    if ((step > 0 && value >= target) || (step < 0 && value <= target)) {
      value = target;
      clearInterval(interval);
    }
    el.textContent = value.toLocaleString();
  }, 16);
}

function setEnabled(on) {
  pwr.classList.toggle('on', on);
  sbar.classList.toggle('off', !on);
  stxt.textContent = on ? 'Adaptive Protection Active' : 'Protection Paused';
  document.body.classList.toggle('off', !on);
}

function renderRules(customRulesByDomain = {}) {
  const entries = Object.entries(customRulesByDomain)
    .flatMap(([domain, rules]) => (rules || []).map((rule) => ({ domain, rule })));

  rulesList.innerHTML = entries.length
    ? entries.slice(0, 24).map(({ domain, rule }) => `<div class="ritem">${domain} -> ${rule}</div>`).join('')
    : '<div class="empty">No smart rules yet. Use "Report Missed Ad" to teach ShieldBlock.</div>';
}

function renderAllowlist(list) {
  alList.innerHTML = list?.length
    ? list.map((domain) => `
      <div class="alitem">
        <span class="aldomain">${domain}</span>
        <button class="alrm" data-d="${domain}" title="Remove">x</button>
      </div>`).join('')
    : '<div class="empty">No allowed sites. All sites are protected.</div>';

  alList.querySelectorAll('.alrm').forEach((btn) => {
    btn.addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'REMOVE_FROM_ALLOWLIST', domain: btn.dataset.d }, () => loadAll());
    });
  });
}

function renderActivities(items = []) {
  activityList.innerHTML = items.length
    ? items.slice(0, 8).map((item) => `
      <div class="aitem">
        <div class="atitle">${item.title}</div>
        <div class="adetail">${item.detail || ''}</div>
      </div>`).join('')
    : '<div class="empty">No recent activity yet.</div>';
}

function renderSiteInsight(tabInfo) {
  if (!tabInfo?.summary) {
    siteTitle.textContent = 'Current Site Insight';
    siteStatus.textContent = 'Open a normal web page to see local ad-pressure and blocking signals.';
    siteScore.textContent = '--';
    return;
  }

  const { summary } = tabInfo;
  siteTitle.textContent = summary.hostname || 'Current Site Insight';
  siteStatus.textContent = `${summary.status}. Heuristic: ${summary.heuristicBlocked}, ML: ${summary.mlBlocked}, signals: ${summary.candidateSignals}.`;
  siteScore.textContent = `${summary.intrusionScore}/100`;
}

function getEnabledRuleCount(data) {
  if (data.enabled === false) return 0;
  return Object.entries(RULE_COUNTS).reduce((sum, [id, count]) => (
    data[`${id}Enabled`] === false ? sum : sum + count
  ), 0);
}

function loadAll() {
  chrome.runtime.sendMessage({ type: 'GET_STATS' }, (data) => {
    if (!data) return;

    setEnabled(data.enabled !== false);
    anim(tot, data.totalBlocked || 0);
    anim(cAds, data.adsBlocked || 0);
    anim(cTrk, data.trackersBlocked || 0);
    anim(cSess, data.sessionBlocked || 0);
    anim(cAI, data.aiBlocked || 0);
    anim(cML, data.mlBlocked || 0);
    anim(cPh, data.phishingDetected || 0);

    tAds.checked = data.adsEnabled !== false;
    tTrk.checked = data.trackersEnabled !== false;
    tPat.checked = data.patternsEnabled !== false;
    tPop.checked = data.popupsEnabled !== false;
    tYT.checked = data.youtubeEnabled !== false;
    tMal.checked = data.malwareEnabled !== false;
    tAI.checked = data.aiEnabled !== false;
    tML.checked = data.mlEnabled !== false;
    tPh.checked = data.phishingEnabled !== false;
    tCk.checked = data.annoyancesEnabled !== false;

    const heuristicThreshold = data.aiThreshold || 72;
    hSlider.value = heuristicThreshold;
    hVal.textContent = heuristicThreshold;

    const mlThreshold = data.mlThreshold || 88;
    mSlider.value = mlThreshold;
    mVal.textContent = `${mlThreshold}%`;

    renderRules(data.customRulesByDomain || {});
    renderAllowlist(data.allowlist || []);
    renderActivities(data.lastActivities || []);
  });

  chrome.runtime.sendMessage({ type: 'GET_ACTIVE_TAB_INFO' }, (tabInfo) => {
    renderSiteInsight(tabInfo);
  });
}

loadAll();

pwr.addEventListener('click', () => {
  const on = !pwr.classList.contains('on');
  setEnabled(on);
  chrome.runtime.sendMessage({ type: 'TOGGLE_EXTENSION', enabled: on }, () => loadAll());
});

[['tAds', 'ads'], ['tTrk', 'trackers'], ['tPat', 'patterns'], ['tPop', 'popups'], ['tYT', 'youtube'], ['tMal', 'malware']]
  .forEach(([id, category]) => {
    $(id).addEventListener('change', (event) => {
      chrome.runtime.sendMessage({ type: 'TOGGLE_CATEGORY', category, enabled: event.target.checked }, () => loadAll());
    });
  });

tAI.addEventListener('change', (event) => chrome.runtime.sendMessage({ type: 'TOGGLE_AI', enabled: event.target.checked }, () => loadAll()));
tML.addEventListener('change', (event) => chrome.runtime.sendMessage({ type: 'TOGGLE_ML', enabled: event.target.checked }, () => loadAll()));
tPh.addEventListener('change', (event) => chrome.runtime.sendMessage({ type: 'TOGGLE_PHISHING', enabled: event.target.checked }, () => loadAll()));
tCk.addEventListener('change', (event) => chrome.runtime.sendMessage({ type: 'TOGGLE_ANNOYANCES', enabled: event.target.checked }, () => loadAll()));

hSlider.addEventListener('input', () => {
  const value = parseInt(hSlider.value, 10);
  hVal.textContent = value;
  chrome.runtime.sendMessage({ type: 'UPDATE_SETTING', key: 'aiThreshold', value });
});

mSlider.addEventListener('input', () => {
  const value = parseInt(mSlider.value, 10);
  mVal.textContent = `${value}%`;
  chrome.runtime.sendMessage({ type: 'UPDATE_SETTING', key: 'mlThreshold', value });
});

pickBtn.addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'ACTIVATE_PICKER' });
  window.close();
});

clrRules.addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'CLEAR_CUSTOM_RULES' }, () => renderRules({}));
});

alAdd.addEventListener('click', () => {
  let domain = alInput.value.trim().toLowerCase();
  if (!domain) return;
  domain = domain.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
  if (!domain.includes('.')) return;
  chrome.runtime.sendMessage({ type: 'ADD_TO_ALLOWLIST', domain }, () => {
    alInput.value = '';
    loadAll();
  });
});

alInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') alAdd.click();
});

rstBtn.addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'RESET_STATS' }, () => {
    [tot, cAds, cTrk, cAI, cML, cPh, cSess].forEach((el) => anim(el, 0));
    loadAll();
  });
});
