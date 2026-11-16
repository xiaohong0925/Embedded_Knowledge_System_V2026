const root = document.documentElement;
const densityButtons = [...document.querySelectorAll('button[data-density]')];
const sampleSelect = document.querySelector('#sample-select');
const samples = [...document.querySelectorAll('[data-sample]')];
const tocs = [...document.querySelectorAll('[data-toc]')];
const summary = document.querySelector('#density-summary');

const summaries = {
  a: 'A 当前排版 · 正文 17px／1.85 · 代码 14px／1.75 · 容器 940px',
  b: 'B 紧凑候选 · 正文 16px／1.70 · 代码 13px／1.60 · 容器 760px',
  b2: 'B2 紧凑伸展 · 正文 16px／1.70 · 模拟三栏 · 正文最大 940px',
};

function setDensity(value) {
  root.dataset.density = value;
  summary.textContent = summaries[value];
  for (const button of densityButtons) {
    button.setAttribute('aria-pressed', String(button.dataset.density === value));
  }
}

function setSample(value) {
  for (const sample of samples) {
    sample.hidden = sample.dataset.sample !== value;
  }
  for (const toc of tocs) {
    toc.hidden = toc.dataset.toc !== value;
  }
  window.scrollTo({ top: 0, behavior: 'instant' });
}

for (const button of densityButtons) {
  button.addEventListener('click', () => setDensity(button.dataset.density));
}

sampleSelect.addEventListener('change', (event) => setSample(event.target.value));
