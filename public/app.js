'use strict';

const state = {
  presets: {},
  currentModelKey: 'dendritic',
  model: null
};

const el = {
  presetSelect: document.getElementById('presetSelect'),
  resetBtn: document.getElementById('resetBtn'),
  simulateBtn: document.getElementById('simulateBtn'),
  freqMin: document.getElementById('freqMin'),
  freqMax: document.getElementById('freqMax'),
  ppd: document.getElementById('ppd'),
  regionsContainer: document.getElementById('regionsContainer'),
  kpiRow: document.getElementById('kpiRow'),
  nyquistPlot: document.getElementById('nyquistPlot'),
  bodeMagPlot: document.getElementById('bodeMagPlot'),
  bodePhasePlot: document.getElementById('bodePhasePlot')
};

function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function fmtNumber(value) {
  const abs = Math.abs(value);
  if (abs === 0) {
    return '0';
  }
  if (abs >= 1000 || abs < 1e-3) {
    return value.toExponential(3);
  }
  return value.toFixed(3);
}

function buildPresetSelect() {
  const keys = Object.keys(state.presets);
  el.presetSelect.innerHTML = keys
    .map((key) => `<option value="${key}">${state.presets[key].name}</option>`)
    .join('');
  el.presetSelect.value = state.currentModelKey;
}

function renderTopLevelFields() {
  el.freqMin.value = state.model.frequency.minHz;
  el.freqMax.value = state.model.frequency.maxHz;
  el.ppd.value = state.model.frequency.pointsPerDecade;
}

function regionCard(region, index) {
  return `
    <section class="region-card" data-region-index="${index}">
      <h3>${region.label}</h3>
      <div class="region-grid">
        <label>
          slices
          <input data-field="slices" type="number" min="8" max="800" step="1" value="${region.slices}" />
        </label>
        <label>
          R1 (Ω)
          <input data-field="r1" type="number" min="1e-12" step="any" value="${region.r1}" />
        </label>
        <label>
          R2 (Ω)
          <input data-field="r2" type="number" min="1e-12" step="any" value="${region.r2}" />
        </label>
        <label>
          Q (CPE/Cap)
          <input data-field="storage.q" type="number" min="1e-12" step="any" value="${region.storage.q}" />
        </label>
        <label>
          α (0-1)
          <input data-field="storage.alpha" type="number" min="0" max="1" step="0.01" value="${region.storage.alpha}" />
        </label>
      </div>

      <div class="reaction-toggle">
        <input data-field="reaction.enabled" type="checkbox" ${region.reaction && region.reaction.enabled ? 'checked' : ''} />
        <span>启用反应支路 (R + CPE)</span>
      </div>

      <div class="region-grid">
        <label>
          R<sub>rxn</sub> (Ω)
          <input data-field="reaction.r" type="number" min="1e-12" step="any" value="${region.reaction ? region.reaction.r : 1}" />
        </label>
        <label>
          Q<sub>rxn</sub>
          <input data-field="reaction.q" type="number" min="1e-12" step="any" value="${region.reaction ? region.reaction.q : 1e-9}" />
        </label>
        <label>
          α<sub>rxn</sub>
          <input data-field="reaction.alpha" type="number" min="0" max="1" step="0.01" value="${region.reaction ? region.reaction.alpha : 1}" />
        </label>
      </div>
    </section>
  `;
}

function renderRegions() {
  el.regionsContainer.innerHTML = state.model.regions.map(regionCard).join('');

  el.regionsContainer.querySelectorAll('.region-card').forEach((card) => {
    const idx = Number(card.getAttribute('data-region-index'));

    card.querySelectorAll('input').forEach((input) => {
      input.addEventListener('input', () => {
        const field = input.getAttribute('data-field');
        const parts = field.split('.');
        let target = state.model.regions[idx];
        for (let i = 0; i < parts.length - 1; i += 1) {
          target = target[parts[i]];
        }
        const key = parts[parts.length - 1];

        if (input.type === 'checkbox') {
          target[key] = input.checked;
          return;
        }

        const parsed = Number(input.value);
        target[key] = Number.isFinite(parsed) ? parsed : target[key];
      });
    });
  });
}

function renderModel() {
  renderTopLevelFields();
  renderRegions();
}

async function fetchPresets() {
  const response = await fetch('/api/presets');
  if (!response.ok) {
    throw new Error('无法加载预设');
  }
  const data = await response.json();
  state.presets = data.presets;
  state.currentModelKey = state.presets.dendritic ? 'dendritic' : Object.keys(state.presets)[0];
  state.model = deepClone(state.presets[state.currentModelKey]);
  buildPresetSelect();
  renderModel();
}

function syncGlobalFields() {
  state.model.frequency.minHz = Number(el.freqMin.value);
  state.model.frequency.maxHz = Number(el.freqMax.value);
  state.model.frequency.pointsPerDecade = Number(el.ppd.value);
}

function updateKpis(summary) {
  const rows = [
    { label: 'HF 截距 (Ω)', value: fmtNumber(summary.hfInterceptOhm) },
    { label: '低频 Re(Z) (Ω)', value: fmtNumber(summary.lfRealOhm) },
    { label: 'max -Im(Z) (Ω)', value: fmtNumber(summary.maxNegImagOhm) }
  ];

  el.kpiRow.innerHTML = rows
    .map((row) => `
      <article class="kpi">
        <div class="label">${row.label}</div>
        <div class="value">${row.value}</div>
      </article>
    `)
    .join('');
}

function renderPlots(result) {
  const xNy = result.zReal;
  const yNy = result.zImag.map((v) => -v);
  const nyquistMeta = result.frequenciesHz.map((f, i) => [
    f,
    result.zMag[i],
    result.phaseDeg[i]
  ]);

  Plotly.newPlot(el.nyquistPlot, [
    {
      x: xNy,
      y: yNy,
      customdata: nyquistMeta,
      hovertemplate:
        'f: %{customdata[0]:.3e} Hz' +
        '<br>Re(Z): %{x:.5g} Ω' +
        '<br>-Im(Z): %{y:.5g} Ω' +
        '<br>|Z|: %{customdata[1]:.5g} Ω' +
        '<br>Phase: %{customdata[2]:.3f}°' +
        '<extra></extra>',
      mode: 'lines',
      line: { color: '#0b7d61', width: 2.2 },
      name: 'Nyquist'
    }
  ], {
    margin: { l: 58, r: 24, t: 8, b: 52 },
    paper_bgcolor: 'white',
    plot_bgcolor: 'white',
    xaxis: { title: 'Re(Z) / Ω', zeroline: false, gridcolor: '#e9efed' },
    yaxis: { title: '-Im(Z) / Ω', zeroline: false, gridcolor: '#e9efed' },
    hovermode: 'closest'
  }, { responsive: true, displaylogo: false });

  const fAsc = [...result.frequenciesHz].reverse();
  const zMagAsc = [...result.zMag].reverse();
  const phaseAsc = [...result.phaseDeg].reverse();
  const zRealAsc = [...result.zReal].reverse();
  const zImagAsc = [...result.zImag].reverse();

  Plotly.newPlot(el.bodeMagPlot, [
    {
      x: fAsc,
      y: zMagAsc,
      customdata: zRealAsc.map((re, i) => [re, zImagAsc[i], phaseAsc[i]]),
      hovertemplate:
        'f: %{x:.3e} Hz' +
        '<br>|Z|: %{y:.5g} Ω' +
        '<br>Re(Z): %{customdata[0]:.5g} Ω' +
        '<br>Im(Z): %{customdata[1]:.5g} Ω' +
        '<br>Phase: %{customdata[2]:.3f}°' +
        '<extra></extra>',
      mode: 'lines',
      line: { color: '#d95a17', width: 2 },
      name: '|Z|'
    }
  ], {
    margin: { l: 58, r: 24, t: 8, b: 52 },
    paper_bgcolor: 'white',
    plot_bgcolor: 'white',
    xaxis: { title: 'f / Hz', type: 'log', gridcolor: '#e9efed' },
    yaxis: { title: '|Z| / Ω', type: 'log', gridcolor: '#e9efed' },
    hovermode: 'x'
  }, { responsive: true, displaylogo: false });

  Plotly.newPlot(el.bodePhasePlot, [
    {
      x: fAsc,
      y: phaseAsc,
      customdata: zMagAsc.map((mag, i) => [mag, zRealAsc[i], zImagAsc[i]]),
      hovertemplate:
        'f: %{x:.3e} Hz' +
        '<br>Phase: %{y:.3f}°' +
        '<br>|Z|: %{customdata[0]:.5g} Ω' +
        '<br>Re(Z): %{customdata[1]:.5g} Ω' +
        '<br>Im(Z): %{customdata[2]:.5g} Ω' +
        '<extra></extra>',
      mode: 'lines',
      line: { color: '#2058a8', width: 2 },
      name: 'Phase'
    }
  ], {
    margin: { l: 58, r: 24, t: 8, b: 52 },
    paper_bgcolor: 'white',
    plot_bgcolor: 'white',
    xaxis: { title: 'f / Hz', type: 'log', gridcolor: '#e9efed' },
    yaxis: { title: 'Phase / deg', gridcolor: '#e9efed' },
    hovermode: 'x'
  }, { responsive: true, displaylogo: false });
}

async function runSimulation() {
  syncGlobalFields();

  const response = await fetch('/api/simulate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: state.model })
  });

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || '仿真失败');
  }

  updateKpis(payload.summary);
  renderPlots(payload);
}

function bindEvents() {
  el.presetSelect.addEventListener('change', () => {
    state.currentModelKey = el.presetSelect.value;
    state.model = deepClone(state.presets[state.currentModelKey]);
    renderModel();
  });

  el.resetBtn.addEventListener('click', () => {
    state.model = deepClone(state.presets[state.currentModelKey]);
    renderModel();
  });

  el.simulateBtn.addEventListener('click', async () => {
    el.simulateBtn.disabled = true;
    el.simulateBtn.textContent = '计算中...';
    try {
      await runSimulation();
    } catch (error) {
      window.alert(error.message);
    } finally {
      el.simulateBtn.disabled = false;
      el.simulateBtn.textContent = '仿真';
    }
  });
}

async function boot() {
  try {
    await fetchPresets();
    bindEvents();
    await runSimulation();
  } catch (error) {
    window.alert(`初始化失败: ${error.message}`);
  }
}

boot();
