from __future__ import annotations

import copy
import math
from typing import Any

DEFAULT_PRESETS = {
    "dendritic": {
        "name": "Dendritic Li (Figure 5-like)",
        "frequency": {
            "minHz": 1e-3,
            "maxHz": 1e6,
            "pointsPerDecade": 8,
        },
        "regions": [
            {
                "key": "live",
                "label": "Live Dendrite",
                "slices": 120,
                "r1": 60,
                "r2": 10,
                "storage": {
                    "q": 6e-2,
                    "alpha": 0.95,
                },
                "reaction": {
                    "enabled": True,
                    "r": 9,
                    "q": 7e-6,
                    "alpha": 0.85,
                },
            },
            {
                "key": "dead",
                "label": "Dead Dendrite",
                "slices": 120,
                "r1": 40,
                "r2": 5,
                "storage": {
                    "q": 0.5,
                    "alpha": 0.75,
                },
                "reaction": {
                    "enabled": False,
                    "r": 1,
                    "q": 1e-9,
                    "alpha": 1,
                },
            },
            {
                "key": "separator",
                "label": "Separator",
                "slices": 120,
                "r1": 18,
                "r2": 3,
                "storage": {
                    "q": 0.1,
                    "alpha": 0.85,
                },
                "reaction": {
                    "enabled": False,
                    "r": 1,
                    "q": 1e-9,
                    "alpha": 1,
                },
            },
        ],
    },
    "pristine": {
        "name": "Pristine Li (Figure 4-like)",
        "frequency": {
            "minHz": 1e-3,
            "maxHz": 1e6,
            "pointsPerDecade": 8,
        },
        "regions": [
            {
                "key": "porous_sei",
                "label": "Porous SEI",
                "slices": 150,
                "r1": 6,
                "r2": 2,
                "storage": {
                    "q": 5.8e-3,
                    "alpha": 0.96,
                },
                "reaction": {
                    "enabled": True,
                    "r": 119,
                    "q": 5.9e-6,
                    "alpha": 0.89,
                },
            },
            {
                "key": "separator",
                "label": "Separator",
                "slices": 150,
                "r1": 18,
                "r2": 2.5,
                "storage": {
                    "q": 9.5e-2,
                    "alpha": 0.85,
                },
                "reaction": {
                    "enabled": False,
                    "r": 1,
                    "q": 1e-9,
                    "alpha": 1,
                },
            },
        ],
    },
}

GMIN = 1e-18
EPS = 1e-30


def _clone(value: Any) -> Any:
    return copy.deepcopy(value)


def _clamp(value: float, min_value: float, max_value: float) -> float:
    return min(max(value, min_value), max_value)


def _to_positive_number(value: Any, fallback: float) -> float:
    try:
        n = float(value)
        if math.isfinite(n) and n > 0:
            return n
    except (TypeError, ValueError):
        pass
    return fallback


def _to_unit_interval(value: Any, fallback: float) -> float:
    try:
        n = float(value)
        if math.isfinite(n):
            return _clamp(n, 0.0, 1.0)
    except (TypeError, ValueError):
        pass
    return fallback


def normalize_preset(input_model: dict[str, Any] | None) -> dict[str, Any]:
    fallback = DEFAULT_PRESETS["dendritic"]
    model = _clone(input_model) if input_model and isinstance(input_model.get("regions"), list) else _clone(fallback)

    model.setdefault("frequency", {})
    frequency = model["frequency"]

    frequency["minHz"] = _to_positive_number(frequency.get("minHz"), fallback["frequency"]["minHz"])
    frequency["maxHz"] = _to_positive_number(frequency.get("maxHz"), fallback["frequency"]["maxHz"])

    if frequency["maxHz"] < frequency["minHz"]:
        frequency["minHz"], frequency["maxHz"] = frequency["maxHz"], frequency["minHz"]

    ppd = round(_to_positive_number(frequency.get("pointsPerDecade"), fallback["frequency"]["pointsPerDecade"]))
    frequency["pointsPerDecade"] = int(_clamp(ppd, 2, 60))

    normalized_regions: list[dict[str, Any]] = []
    for idx, region in enumerate(model.get("regions", [])):
        if not isinstance(region, dict):
            continue

        fallback_region = fallback["regions"][min(idx, len(fallback["regions"]) - 1)]
        storage = region.get("storage") or {}
        reaction = region.get("reaction") or {}

        normalized = {
            "key": str(region.get("key") or fallback_region.get("key") or f"region_{idx + 1}"),
            "label": str(region.get("label") or fallback_region.get("label") or f"Region {idx + 1}"),
            "slices": int(
                _clamp(
                    round(_to_positive_number(region.get("slices"), fallback_region.get("slices", 80))),
                    8,
                    800,
                )
            ),
            "r1": _to_positive_number(region.get("r1"), fallback_region.get("r1", 1)),
            "r2": _to_positive_number(region.get("r2"), fallback_region.get("r2", 1)),
            "storage": {
                "q": _to_positive_number(storage.get("q"), fallback_region.get("storage", {}).get("q", 1e-3)),
                "alpha": _to_unit_interval(storage.get("alpha"), fallback_region.get("storage", {}).get("alpha", 1)),
            },
            "reaction": {
                "enabled": bool(reaction.get("enabled")),
                "r": _to_positive_number(reaction.get("r"), fallback_region.get("reaction", {}).get("r", 1)),
                "q": _to_positive_number(reaction.get("q"), fallback_region.get("reaction", {}).get("q", 1e-6)),
                "alpha": _to_unit_interval(reaction.get("alpha"), fallback_region.get("reaction", {}).get("alpha", 1)),
            },
        }

        if normalized["slices"] > 0:
            normalized_regions.append(normalized)

    if not normalized_regions:
        return _clone(fallback)

    model["regions"] = normalized_regions
    return model


def generate_frequencies(min_hz: float, max_hz: float, points_per_decade: int) -> list[float]:
    min_log = math.log10(min_hz)
    max_log = math.log10(max_hz)
    decades = max(max_log - min_log, 1e-6)
    points = max(3, round(decades * points_per_decade) + 1)

    frequencies: list[float] = [0.0] * points
    for i in range(points):
        t = i / (points - 1)
        frequencies[i] = 10 ** (max_log - t * (max_log - min_log))
    return frequencies


def _c_inv(z: complex) -> complex:
    return complex(z.real, -z.imag) / (z.real * z.real + z.imag * z.imag + EPS)


def _c_abs(z: complex) -> float:
    return math.hypot(z.real, z.imag)


def _c_arg_deg(z: complex) -> float:
    return math.degrees(math.atan2(z.imag, z.real))


def _jw_pow(omega: float, alpha: float) -> complex:
    magnitude = omega ** alpha
    angle = 0.5 * math.pi * alpha
    return complex(magnitude * math.cos(angle), magnitude * math.sin(angle))


def _cpe_admittance(q: float, alpha: float, omega: float) -> complex:
    if q <= 0 or omega <= 0:
        return 0j
    return q * _jw_pow(omega, alpha)


def _safe_conductance_from_resistance(r: float) -> complex:
    if not math.isfinite(r) or r <= 0:
        return complex(1 / GMIN, 0.0)
    return complex(1 / r, 0.0)


Mat2 = tuple[complex, complex, complex, complex]
Vec2 = tuple[complex, complex]


def _mat_zero() -> Mat2:
    return (0j, 0j, 0j, 0j)


def _mat_sub(m1: Mat2, m2: Mat2) -> Mat2:
    return (
        m1[0] - m2[0],
        m1[1] - m2[1],
        m1[2] - m2[2],
        m1[3] - m2[3],
    )


def _mat_mul(m1: Mat2, m2: Mat2) -> Mat2:
    a11 = m1[0] * m2[0] + m1[1] * m2[2]
    a12 = m1[0] * m2[1] + m1[1] * m2[3]
    a21 = m1[2] * m2[0] + m1[3] * m2[2]
    a22 = m1[2] * m2[1] + m1[3] * m2[3]
    return (a11, a12, a21, a22)


def _mat_vec_mul(m: Mat2, v: Vec2) -> Vec2:
    return (
        m[0] * v[0] + m[1] * v[1],
        m[2] * v[0] + m[3] * v[1],
    )


def _vec_sub(v1: Vec2, v2: Vec2) -> Vec2:
    return (v1[0] - v2[0], v1[1] - v2[1])


def _mat_inv(m: Mat2) -> Mat2:
    det = m[0] * m[3] - m[1] * m[2]
    inv_det = _c_inv(det)
    return (
        m[3] * inv_det,
        -m[1] * inv_det,
        -m[2] * inv_det,
        m[0] * inv_det,
    )


def _solve_block_tridiagonal(A: list[Mat2], B: list[Mat2], C: list[Mat2], D: list[Vec2], n: int) -> list[Vec2]:
    c_prime: list[Mat2] = [_mat_zero()] * (n + 1)
    d_prime: list[Vec2] = [(0j, 0j)] * (n + 1)

    inv_b1 = _mat_inv(B[1])
    c_prime[1] = _mat_mul(inv_b1, C[1])
    d_prime[1] = _mat_vec_mul(inv_b1, D[1])

    for i in range(2, n + 1):
        denominator = _mat_sub(B[i], _mat_mul(A[i], c_prime[i - 1]))
        inv_denominator = _mat_inv(denominator)
        rhs = _vec_sub(D[i], _mat_vec_mul(A[i], d_prime[i - 1]))
        c_prime[i] = _mat_zero() if i == n else _mat_mul(inv_denominator, C[i])
        d_prime[i] = _mat_vec_mul(inv_denominator, rhs)

    x: list[Vec2] = [(0j, 0j)] * (n + 1)
    x[n] = d_prime[n]

    for i in range(n - 1, 0, -1):
        x[i] = _vec_sub(d_prime[i], _mat_vec_mul(c_prime[i], x[i + 1]))

    return x


def _build_distributed_network(model: dict[str, Any], omega: float) -> tuple[int, list[complex], list[complex], list[complex]]:
    total_slices = sum(region["slices"] for region in model["regions"])
    g_top: list[complex] = [0j] * total_slices
    g_bottom: list[complex] = [0j] * total_slices
    y_shunt: list[complex] = [0j] * (total_slices + 1)

    seg_offset = 0
    for region in model["regions"]:
        n = region["slices"]

        g_top_segment = _safe_conductance_from_resistance(region["r1"] / n)
        g_bottom_segment = _safe_conductance_from_resistance(region["r2"] / n)

        storage_q_per_node = region["storage"]["q"] / n
        reaction = region.get("reaction", {})
        reaction_enabled = bool(reaction.get("enabled"))
        reaction_r_node = reaction.get("r", 1) * n if reaction_enabled else 1
        reaction_q_node = reaction.get("q", 0) / n if reaction_enabled else 0

        for k in range(n):
            g_top[seg_offset + k] = g_top_segment
            g_bottom[seg_offset + k] = g_bottom_segment

        for local_node in range(1, n + 1):
            global_node = seg_offset + local_node
            y_node = _cpe_admittance(storage_q_per_node, region["storage"]["alpha"], omega)

            if reaction_enabled:
                y_r = _safe_conductance_from_resistance(reaction_r_node)
                y_c = _cpe_admittance(reaction_q_node, reaction.get("alpha", 1), omega)
                y_node = y_node + y_r + y_c

            y_shunt[global_node] = y_shunt[global_node] + y_node

        seg_offset += n

    return total_slices, g_top, g_bottom, y_shunt


def _impedance_at_frequency(model: dict[str, Any], omega: float) -> complex:
    n, g_top, g_bottom, y_shunt = _build_distributed_network(model, omega)

    if n < 1:
        return complex(1e18, 0)

    A: list[Mat2] = [_mat_zero()] * (n + 1)
    B: list[Mat2] = [_mat_zero()] * (n + 1)
    C: list[Mat2] = [_mat_zero()] * (n + 1)
    D: list[Vec2] = [(0j, 0j)] * (n + 1)

    for i in range(1, n + 1):
        g_top_left = g_top[i - 1]
        g_bottom_left = g_bottom[i - 1]
        g_top_right = g_top[i] if i < n else 0j
        g_bottom_right = g_bottom[i] if i < n else 0j
        y = y_shunt[i]

        diag_top = g_top_left + g_top_right + y + complex(GMIN, 0)
        diag_bottom = g_bottom_left + g_bottom_right + y + complex(GMIN, 0)

        A[i] = (-g_top_left, 0j, 0j, -g_bottom_left)
        B[i] = (diag_top, -y, -y, diag_bottom)
        C[i] = (-g_top_right, 0j, 0j, -g_bottom_right) if i < n else _mat_zero()
        D[i] = (g_top_left, 0j) if i == 1 else (0j, 0j)

    voltages = _solve_block_tridiagonal(A, B, C, D, n)
    v_top_1 = voltages[1][0]
    i_in = g_top[0] * (1 + 0j - v_top_1)

    if _c_abs(i_in) < 1e-20:
        return complex(1e18, 0)

    return _c_inv(i_in)


def simulate_model(raw_input: dict[str, Any] | None) -> dict[str, Any]:
    model = normalize_preset(raw_input)
    frequencies = generate_frequencies(
        model["frequency"]["minHz"],
        model["frequency"]["maxHz"],
        model["frequency"]["pointsPerDecade"],
    )

    z_real: list[float] = []
    z_imag: list[float] = []
    z_mag: list[float] = []
    phase_deg: list[float] = []

    for f in frequencies:
        omega = 2 * math.pi * f
        z = _impedance_at_frequency(model, omega)
        z_real.append(float(z.real))
        z_imag.append(float(z.imag))
        z_mag.append(float(_c_abs(z)))
        phase_deg.append(float(_c_arg_deg(z)))

    return {
        "model": model,
        "frequenciesHz": frequencies,
        "zReal": z_real,
        "zImag": z_imag,
        "zMag": z_mag,
        "phaseDeg": phase_deg,
        "summary": {
            "hfInterceptOhm": z_real[0],
            "lfRealOhm": z_real[-1],
            "maxNegImagOhm": max(-v for v in z_imag),
        },
    }


PRESETS = _clone(DEFAULT_PRESETS)
