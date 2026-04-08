"""
Build `data/uk_universe.txt` from a curated FTSE 350–style + AIM list (Yahoo `.L` tickers).

Hardcoded list avoids brittle scraping; refresh tickers periodically (delistings, renames).
Run from repo `cosmo/` root: `python data/populate_universe.py`
"""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Iterable, List

_ROOT = Path(__file__).resolve().parents[1]
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

import config

# Curated: FTSE 100/250-style large/mid caps + liquid AIM names. Deduplicated on save.
# Not every line is guaranteed still listed; stage-1 screening drops dead tickers.
_RAW_FTSE_AND_AIM = """
AAL.L ABF.L ADM.L AHT.L ANTO.L AUTO.L AV.L AZN.L BA.L BARC.L BATS.L BKG.L BLND.L BNZL.L BP.L
BRBY.L BT-A.L CCH.L CNA.L CPG.L CRDA.L CRH.L DCC.L DGE.L DPLM.L EDV.L ELM.L ENT.L EXPN.L EZJ.L
FERG.L FRES.L GLEN.L GSK.L HIK.L HL.L HSBA.L IAG.L IMB.L INF.L ITRK.L JD.L KGF.L LAND.L LGEN.L
LLOY.L LMP.L MKS.L MNDI.L MNG.L MP.L NG.L NXT.L OCDO.L OR.L PHNX.L PRU.L PSON.L REL.L RIO.L
RMV.L RTO.L SBRY.L SDR.L SGE.L SHEL.L SMIN.L SN.L SPX.L SSE.L STAN.L STJ.L SVT.L SVT.L TATE.L
TSCO.L TW.L ULVR.L UU.L VOD.L WEIR.L WPP.L WTB.L 3IN.L AJB.L ATST.L BAB.L BBY.L BDEV.L BWY.L
BYW.L CCC.L CHG.L CLLN.L CTG.L DLG.L DTY.L ESNT.L FCIT.L FGP.L GAW.L GNC.L HAS.L HFD.L HSV.L
HWDN.L IMI.L INCH.L IPO.L ITV.L JMAT.L JUP.L KLR.L LAD.L LSE.L MCRO.L MTO.L NWG.L OCDO.L
PAGE.L PFC.L POLY.L RDW.L RHIM.L RICA.L RM.L RNK.L ROR.L SCT.L SHI.L SMWH.L SNR.L SR.L
STHR.L SRP.L TPK.L TRIG.L TUNE.L VTY.L WIZZ.L WOSG.L BOY.L BOO.L ASC.L MONY.L PLUS.L PREM.L
KOD.L BOOM.L CAPD.L CLG.L FEVR.L GHH.L HBR.L IGP.L JSE.L KLR.L MOON.L OTB.L PAT.L SFOR.L
TRCS.L VNET.L BOO.L CCC.L
"""

# Single-column fallback block (additions, less liquid names)
_EXTRA_LINES = """
AAF.L
AGR.L
AML.L
ATT.L
AVON.L
BBH.L
BGEO.L
BME.L
BNKR.L
BRCK.L
CAR.L
CBG.L
CCC.L
CINE.L
CLLN.L
CMCX.L
COA.L
CPG.L
CTO.L
CVSG.L
DFS.L
DNLM.L
DOM.L
DRX.L
ECM.L
EQT.L
FAN.L
FXPO.L
GFRD.L
GRG.L
HMSO.L
HOC.L
HSX.L
HVT.L
ICP.L
IGG.L
INVP.L
IPF.L
IPO.L
IQE.L
JAM.L
KIE.L
KWS.L
LAD.L
LAM.L
LGEN.L
LIO.L
LSEG.L
MARS.L
MTO.L
NCC.L
NEX.L
NWG.L
OCDO.L
PDL.L
PIER.L
PNN.L
PPH.L
PZC.L
RBS.L
RCP.L
RE.L
RFX.L
RPS.L
SAFE.L
SCIN.L
SDL.L
SFOR.L
SGRO.L
SHI.L
SKG.L
SMIN.L
SMS.L
SN.L
SPD.L
SSON.L
STAF.L
STJ.L
SVS.L
SXS.L
TCAP.L
TEM.L
TPK.L
TRCS.L
TRMR.L
TUI.L
UKW.L
VCT.L
VTU.L
WIX.L
WIZZ.L
WOSG.L
WTB.L
XAR.L
"""


def _parse_tokens(raw: str) -> List[str]:
    parts: List[str] = []
    for tok in raw.replace("\n", " ").split():
        t = tok.strip().upper()
        if t and not t.startswith("#"):
            parts.append(t)
    return parts


def get_ftse_350_symbols() -> List[str]:
    """
    Return sorted unique UK symbols (FTSE 350–style + AIM subset).

    Yahoo suffix `.L` for London. Update this list as the index changes.
    """
    seen: set[str] = set()
    out: List[str] = []
    for sym in _parse_tokens(_RAW_FTSE_AND_AIM) + [
        ln.strip().upper() for ln in _EXTRA_LINES.splitlines() if ln.strip()
    ]:
        if sym.endswith(".L") and sym not in seen:
            seen.add(sym)
            out.append(sym)
    out.sort()
    return out


def save_universe(symbols: Iterable[str], path: Path) -> int:
    """Write one symbol per line; return count written."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    lines = sorted({s.strip().upper() for s in symbols if s.strip()})
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return len(lines)


def load_universe(path: Path) -> List[str]:
    """Load symbols from a text file (one per line, # comments allowed)."""
    path = Path(path)
    if not path.is_file():
        return []
    out: List[str] = []
    for ln in path.read_text(encoding="utf-8", errors="ignore").splitlines():
        s = ln.split("#", 1)[0].strip().upper()
        if s:
            out.append(s)
    return out


def populate_universe() -> List[str]:
    """Merge curated list, save to `config.UK_UNIVERSE_FILE`, return symbols."""
    symbols = get_ftse_350_symbols()
    n = save_universe(symbols, Path(config.UK_UNIVERSE_FILE))
    print(f"Saved {n} symbols to {config.UK_UNIVERSE_FILE}")
    return symbols


if __name__ == "__main__":
    populate_universe()
