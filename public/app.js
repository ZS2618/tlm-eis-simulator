'use strict';

const state = {
  presets: {},
  currentModelKey: 'dendritic',
  model: null,
  measuredData: null,
  lastSimulation: null
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
  bodePhasePlot: document.getElementById('bodePhasePlot'),
  csvInput: document.getElementById('csvInput'),
  fitIterations: document.getElementById('fitIterations'),
  fitBtn: document.getElementById('fitBtn'),
  fitStatus: document.getElementById('fitStatus')
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

function setFitStatus(text, isError = false) {
  el.fitStatus.textContent = text;
  el.fitStatus.style.color = isError ? '#9d2424' : '#526063';
  el.fitStatus.style.borderColor = isError ? '#e3b0b0' : '#c8d4cf';
}

function detectDelimiter(line) {
  const candidates = [',', ';', '\t'];
  let best = ',';
  let bestCount = -1;
  candidates.forEach((sep) => {
    const count = line.split(sep).length;
    if (count > bestCount) {
      best = sep;
      bestCount = count;
    }
  });
  return best;
}

function parseMeasuredCsv(text) {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length < 5) {
    throw new Error('CSV 数据点过少');
  }

  const delimiter = detectDelimiter(lines[0]);
  const points = [];

  lines.forEach((line) => {
    const cols = line.split(delimiter).map((v) => v.trim());
    if (cols.length < 3) {
      return;
    }

    const f = Number(cols[0]);
    const zre = Number(cols[1]);
    const zim = Number(cols[2]);

    if (!Number.isFinite(f) || !Number.isFinite(zre) || !Number.isFinite(zim) || f <= 0) {
      return;
    }

    points.push({ f, zre, zim });
  });

  if (points.length < 5) {
    throw new Error('未解析到足够有效数据，需至少 5 个点；列格式应为 f, Re(Z), Im(Z)');
  }

  points.sort((a, b) => b.f - a.f);
  return points;
}

function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('读取文件失败'));
    reader.readAsText(file);
  });
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

  if (state.presets.full_figure5) {
    state.currentModelKey = 'full_figure5';
  } else if (state.presets.dendritic) {
    state.currentModelKey = 'dendritic';
  } else {
    state.currentModelKey = Object.keys(state.presets)[0];
  }

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

function estimateRegionPeakFrequency(region) {
  const rTotal = Math.max(Number(region.r1) + Number(region.r2), 1e-12);
  const q = Math.max(Number(region.storage?.q), 1e-12);
  const tau = rTotal * q;
  return 1 / (2 * Math.PI * Math.max(tau, 1e-18));
}

function findAttributionIndex(frequenciesHz, yNy, targetF) {
  let nearest = 0;
  let nearestErr = Infinity;
  const targetLog = Math.log10(Math.max(targetF, 1e-12));

  for (let i = 0; i < frequenciesHz.length; i += 1) {
    const err = Math.abs(Math.log10(Math.max(frequenciesHz[i], 1e-12)) - targetLog);
    if (err < nearestErr) {
      nearestErr = err;
      nearest = i;
    }
  }

  const left = Math.max(0, nearest - 5);
  const right = Math.min(yNy.length - 1, nearest + 5);
  let best = nearest;
  for (let i = left; i <= right; i += 1) {
    if (yNy[i] > yNy[best]) {
      best = i;
    }
  }
  return best;
}

function buildNyquistAttribution(model, result) {
  const colors = ['#d95a17', '#2058a8', '#0b7d61', '#7b3fe4', '#aa3a61'];
  const yNy = result.zImag.map((v) => -v);
  const markerX = [];
  const markerY = [];
  const markerText = [];
  const markerMeta = [];
  const annotations = [];

  model.regions.forEach((region, idx) => {
    let i = -1;
    let confidence = 0;

    if (result.sensitivity && Array.isArray(result.sensitivity.regionPeakIndex)) {
      i = Number(result.sensitivity.regionPeakIndex[idx] ?? -1);
      if (i >= 0 && Array.isArray(result.sensitivity.confidence)) {
        confidence = Number(result.sensitivity.confidence[i] || 0);
      }
    }

    if (!(i >= 0 && i < result.frequenciesHz.length)) {
      const estimatedF = estimateRegionPeakFrequency(region);
      i = findAttributionIndex(result.frequenciesHz, yNy, estimatedF);
    }

    const label = region.label || region.key || `Region ${idx + 1}`;
    const x = result.zReal[i];
    const y = yNy[i];
    const actualF = result.frequenciesHz[i];
    const color = colors[idx % colors.length];

    markerX.push(x);
    markerY.push(y);
    markerText.push(label);
    markerMeta.push([label, actualF, result.zMag[i], result.phaseDeg[i], confidence]);

    annotations.push({
      x,
      y,
      text: confidence > 0 ? `${label} (${(confidence * 100).toFixed(0)}%)` : label,
      showarrow: true,
      arrowhead: 2,
      arrowsize: 1,
      arrowwidth: 1.2,
      arrowcolor: color,
      ax: 18 + (idx % 2) * 16,
      ay: -22 - idx * 6,
      bgcolor: 'rgba(255,255,255,0.88)',
      bordercolor: color,
      borderwidth: 1,
      font: { size: 11, color: '#213335' }
    });
  });

  return { markerX, markerY, markerText, markerMeta, annotations };
}

function measuredSeriesForBode() {
  if (!state.measuredData || !Array.isArray(state.measuredData.points)) {
    return null;
  }

  const points = [...state.measuredData.points].sort((a, b) => a.f - b.f);
  const f = points.map((p) => p.f);
  const zMag = points.map((p) => Math.hypot(p.zre, p.zim));
  const phase = points.map((p) => Math.atan2(p.zim, p.zre) * 180 / Math.PI);
  return { f, zMag, phase };
}

function renderPlots(result) {
  const xNy = result.zReal;
  const yNy = result.zImag.map((v) => -v);
  const nyquistMeta = result.frequenciesHz.map((f, i) => [
    f,
    result.zMag[i],
    result.phaseDeg[i]
  ]);
  const attribution = buildNyquistAttribution(state.model, result);

  const nyquistTraces = [
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
      name: 'Simulated'
    },
    {
      x: attribution.markerX,
      y: attribution.markerY,
      text: attribution.markerText,
      customdata: attribution.markerMeta,
      mode: 'markers',
      marker: {
        size: 8,
        color: '#ffffff',
        line: { width: 2, color: '#24353a' }
      },
      hovertemplate:
        'Region: %{customdata[0]}' +
        '<br>f(point): %{customdata[1]:.3e} Hz' +
        '<br>|Z|: %{customdata[2]:.5g} Ω' +
        '<br>Phase: %{customdata[3]:.3f}°' +
        '<br>Confidence: %{customdata[4]:.2%}' +
        '<extra></extra>',
      name: '归属点',
      showlegend: false
    }
  ];

  if (state.measuredData && Array.isArray(state.measuredData.points)) {
    nyquistTraces.push({
      x: state.measuredData.points.map((p) => p.zre),
      y: state.measuredData.points.map((p) => -p.zim),
      mode: 'markers',
      marker: { size: 6, color: '#a23d16', opacity: 0.75 },
      name: 'Measured',
      hovertemplate:
        'f: %{customdata[0]:.3e} Hz' +
        '<br>Re(Z): %{x:.5g} Ω' +
        '<br>-Im(Z): %{y:.5g} Ω' +
        '<extra></extra>',
      customdata: state.measuredData.points.map((p) => [p.f])
    });
  }

  Plotly.newPlot(el.nyquistPlot, nyquistTraces, {
    margin: { l: 58, r: 24, t: 8, b: 52 },
    paper_bgcolor: 'white',
    plot_bgcolor: 'white',
    xaxis: { title: 'Re(Z) / Ω', zeroline: false, gridcolor: '#e9efed' },
    yaxis: { title: '-Im(Z) / Ω', zeroline: false, gridcolor: '#e9efed' },
    annotations: attribution.annotations,
    hovermode: 'closest'
  }, { responsive: true, displaylogo: false });

  const fAsc = [...result.frequenciesHz].reverse();
  const zMagAsc = [...result.zMag].reverse();
  const phaseAsc = [...result.phaseDeg].reverse();
  const zRealAsc = [...result.zReal].reverse();
  const zImagAsc = [...result.zImag].reverse();

  const bodeMagTraces = [{
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
    name: '|Z| Simulated'
  }];

  const bodePhaseTraces = [{
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
    name: 'Phase Simulated'
  }];

  const measuredBode = measuredSeriesForBode();
  if (measuredBode) {
    bodeMagTraces.push({
      x: measuredBode.f,
      y: measuredBode.zMag,
      mode: 'markers',
      marker: { size: 6, color: '#a23d16', opacity: 0.75 },
      name: '|Z| Measured'
    });
    bodePhaseTraces.push({
      x: measuredBode.f,
      y: measuredBode.phase,
      mode: 'markers',
      marker: { size: 6, color: '#a23d16', opacity: 0.75 },
      name: 'Phase Measured'
    });
  }

  Plotly.newPlot(el.bodeMagPlot, bodeMagTraces, {
    margin: { l: 58, r: 24, t: 8, b: 52 },
    paper_bgcolor: 'white',
    plot_bgcolor: 'white',
    xaxis: { title: 'f / Hz', type: 'log', gridcolor: '#e9efed' },
    yaxis: { title: '|Z| / Ω', type: 'log', gridcolor: '#e9efed' },
    hovermode: 'x'
  }, { responsive: true, displaylogo: false });

  Plotly.newPlot(el.bodePhasePlot, bodePhaseTraces, {
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
    body: JSON.stringify({
      model: state.model,
      includeSensitivity: true,
      perturbation: 0.05
    })
  });

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || '仿真失败');
  }

  state.lastSimulation = payload;
  updateKpis(payload.summary);
  renderPlots(payload);
}

async function runFit() {
  if (!state.measuredData || !Array.isArray(state.measuredData.points)) {
    throw new Error('请先导入 CSV 实测数据');
  }

  syncGlobalFields();
  const iterations = Number(el.fitIterations.value);

  const response = await fetch('/api/fit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: state.model,
      points: state.measuredData.points,
      iterations
    })
  });

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || '拟合失败');
  }

  state.model = payload.fittedModel;
  renderModel();
  setFitStatus(`拟合完成，目标函数: ${payload.objective.toExponential(3)}（点数: ${state.measuredData.points.length}）`);
  await runSimulation();
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

  el.csvInput.addEventListener('change', async () => {
    const file = el.csvInput.files && el.csvInput.files[0];
    if (!file) {
      return;
    }
    try {
      const text = await readFileAsText(file);
      const points = parseMeasuredCsv(text);
      state.measuredData = { points };
      setFitStatus(`已导入 ${points.length} 个实测点，可点击“自动拟合参数”`);
      if (state.lastSimulation) {
        renderPlots(state.lastSimulation);
      }
    } catch (error) {
      state.measuredData = null;
      setFitStatus(error.message, true);
    }
  });

  el.fitBtn.addEventListener('click', async () => {
    el.fitBtn.disabled = true;
    el.fitBtn.textContent = '拟合中...';
    try {
      await runFit();
    } catch (error) {
      setFitStatus(error.message, true);
    } finally {
      el.fitBtn.disabled = false;
      el.fitBtn.textContent = '自动拟合参数';
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
