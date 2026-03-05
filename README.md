# TLM EIS Simulator (Python)

可交互复现 Li 电极传输线模型（TLM）的前后端原型：
- 前端：参数调节 UI + Nyquist/Bode 图
- 后端：纯 Python（标准库）离散传输线求解器 + JSON API

## 功能

- 预设模型：
  - `pristine`（对应论文 Figure 4 量级）
  - `dendritic`（对应论文 Figure 5 量级）
  - `full_figure5`（Figure 5 扩展层级，包含更多传输子层）
- 可调参数：
  - 频率范围、每 decade 采样点
  - 每个区域的 `R1/R2`、分布储能元件 `Q/alpha`
  - 可选反应支路 `R_rxn + CPE_rxn`
  - 区域离散切片数（slices）
- 输出：
  - Nyquist
  - Bode 幅值
  - Bode 相位
  - HF 截距、低频实部、最大负虚部
- 进阶能力：
  - 导入实测 CSV（`f, Re(Z), Im(Z)`）并自动拟合参数
  - 基于参数扰动敏感度的半圆归属标注（替代简单规则法）

## 启动

要求：Python 3.10+

```bash
python3 app.py
```

默认访问地址：`http://127.0.0.1:8787`

## API

### `GET /api/presets`
返回默认模型参数。

### `POST /api/simulate`
请求体可直接传模型对象，或 `{ "model": ... }`。
可选字段：
- `includeSensitivity: true` 返回敏感度归属结果
- `perturbation` 设置扰动比例（默认 0.05）

### `POST /api/fit`
输入：模型初值 + 实测点数组  
输出：拟合后的模型、目标函数、模拟/实测对齐数据

示例：

```json
{
  "model": {
    "frequency": {
      "minHz": 0.001,
      "maxHz": 1000000,
      "pointsPerDecade": 8
    },
    "regions": [
      {
        "key": "live",
        "label": "Live Dendrite",
        "slices": 120,
        "r1": 60,
        "r2": 10,
        "storage": { "q": 0.06, "alpha": 0.95 },
        "reaction": { "enabled": true, "r": 9, "q": 0.000007, "alpha": 0.85 }
      }
    ]
  }
}
```

## 实现说明

- 求解方法为双导轨分布网络的块三对角线性方程求解（2x2 block Thomas algorithm）。
- 储能元件使用 `CPE` 表达式：
  - `Z_cpe = 1 / (Q * (jω)^α)`
  - `Y_cpe = Q * (jω)^α`
- 参数按切片离散到每个 segment/node 后求输入阻抗。

## 目录

- `app.py`: Python HTTP 服务与 API
- `tlm_model.py`: TLM 数值求解核心
- `public/index.html`: UI
- `public/styles.css`: 样式
- `public/app.js`: 前端逻辑与绘图
