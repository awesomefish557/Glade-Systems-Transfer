"""
Stage 1 numerical screen: shrink a broad UK list toward 200–300 names.

Populate `data/uk_universe.txt` (one `.L` symbol per line) to approach 5,000+ names.
"""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Iterable, List, Sequence

import config
from data import fetchers

logger = logging.getLogger(__name__)

# Seed universe if file missing — expand via uk_universe.txt for production scale
_DEFAULT_UK_SEED: List[str] = [
    "VOD.L",
    "BP.L",
    "SHEL.L",
    "HSBA.L",
    "AZN.L",
    "GSK.L",
    "ULVR.L",
    "DGE.L",
    "RIO.L",
    "GLEN.L",
    "LLOY.L",
    "BARC.L",
    "NWG.L",
    "STAN.L",
    "PRU.L",
    "AV.L",
    "LGEN.L",
    "MNG.L",
    "REL.L",
    "CRH.L",
    "AAL.L",
    "ANTO.L",
    "BA.L",
    "RR.L",
    "IMI.L",
    "SMIN.L",
    "WEIR.L",
    "SPX.L",
    "FERG.L",
    "KGF.L",
    "TSCO.L",
    "SBRY.L",
    "MKS.L",
    "NXT.L",
    "JD.L",
    "BME.L",
    "III.L",
    "HL.L",
    "STJ.L",
    "ADM.L",
    "SSE.L",
    "NG.L",
    "SVT.L",
    "CNA.L",
    "UU.L",
    "WPP.L",
    "OML.L",
    "ITV.L",
    "BT-A.L",
]


def get_all_uk_stocks() -> List[str]:
    """
    Load the full UK symbol list.

    Reads `config.UK_UNIVERSE_FILE` when present; otherwise returns a seed list
    and logs guidance to add thousands of lines for production screening.
    """
    path = Path(config.UK_UNIVERSE_FILE)
    if path.is_file():
        lines = [
            ln.strip().upper()
            for ln in path.read_text(encoding="utf-8", errors="ignore").splitlines()
            if ln.strip() and not ln.strip().startswith("#")
        ]
        if lines:
            return lines
    logger.warning(
        "Universe file missing or empty at %s — using %d seed LSE symbols. "
        "Add one ticker per line (e.g. VOD.L) to scale toward 5,000+.",
        path,
        len(_DEFAULT_UK_SEED),
    )
    return list(_DEFAULT_UK_SEED)


def filter_by_market_cap(symbols: Sequence[str], min_cap: float | None = None) -> List[str]:
    min_cap = float(min_cap if min_cap is not None else config.STAGE1_MIN_MARKET_CAP)
    out: List[str] = []
    for sym in symbols:
        cap = fetchers.fetch_market_cap(sym)
        if cap is not None and cap >= min_cap:
            out.append(sym)
    return out


def filter_by_volume(symbols: Sequence[str], min_volume: float | None = None) -> List[str]:
    min_volume = float(min_volume if min_volume is not None else config.STAGE1_MIN_AVG_VOLUME)
    out: List[str] = []
    for sym in symbols:
        vol = fetchers.fetch_volume(sym)
        if vol is not None and vol >= min_volume:
            out.append(sym)
    return out


def filter_by_pe(symbols: Sequence[str], max_pe: float | None = None) -> List[str]:
    max_pe = float(max_pe if max_pe is not None else config.STAGE1_MAX_PE)
    out: List[str] = []
    for sym in symbols:
        pe = fetchers.fetch_pe_ratio(sym)
        if pe is not None and pe > 0 and pe <= max_pe:
            out.append(sym)
    return out


def stage1_screening(symbols: Iterable[str] | None = None) -> List[str]:
    """
    Apply cap → volume → PE filters; trim to configured target band if oversized.
    """
    syms = list(symbols) if symbols is not None else get_all_uk_stocks()
    stage = filter_by_pe(filter_by_volume(filter_by_market_cap(syms)))
    lo, hi = config.STAGE1_TARGET_MIN, config.STAGE1_TARGET_MAX
    if len(stage) > hi:
        stage = stage[:hi]
    elif len(stage) < lo and len(stage) > 0:
        logger.info("Stage1 produced %d names (target %d–%d). Relax filters or widen universe.", len(stage), lo, hi)
    _write_outputs(stage)
    return stage


def _write_outputs(candidates: List[str]) -> None:
    out_dir = Path(config.DISCOVERY_OUTPUT_DIR)
    out_dir.mkdir(parents=True, exist_ok=True)
    csv_path = out_dir / "stage1_candidates.csv"
    json_path = out_dir / "stage1_candidates.json"
    csv_path.write_text("symbol\n" + "\n".join(candidates) + "\n", encoding="utf-8")
    json_path.write_text(json.dumps(candidates, indent=2), encoding="utf-8")
    logger.info("Wrote %d candidates to %s and %s", len(candidates), csv_path, json_path)
