"""
Compare a messy input CSV against a transformed output CSV using pandas.

Validation rules:
  1. output row count <= input row count
  2. output contains no null-like values (NaN, empty string, or the literal
     tokens "NULL"/"null"/"None"/"NaN") unless --allow-nulls is passed.

The script prints a human-readable "Validation Report" to stdout and exits
with a non-zero code on failure so it can be wired into CI.

Defaults resolve next to this script: input.csv / output.csv
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path
from typing import Iterable

import pandas as pd


NULL_TOKENS = {"", "null", "none", "nan", "n/a", "na"}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Validate Rhombus AI pipeline CSV output against messy input.",
    )
    default_dir = Path(__file__).resolve().parent
    parser.add_argument(
        "--input",
        type=Path,
        default=default_dir / "input.csv",
        help="Path to messy/source CSV (default: ./input.csv next to script).",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=default_dir / "output.csv",
        help="Path to transformed CSV (default: ./output.csv next to script).",
    )
    parser.add_argument(
        "--allow-nulls",
        action="store_true",
        help="Allow null/NaN values in the output (default: strict no-null check).",
    )
    return parser.parse_args()


def load_csv(path: Path) -> pd.DataFrame:
    """Read a CSV tolerantly: skip fully empty rows, preserve columns."""
    return pd.read_csv(path, skip_blank_lines=True, dtype=str, keep_default_na=True)


def count_nulls(df: pd.DataFrame) -> tuple[int, pd.Series]:
    """Count NaN + common string sentinels ('', 'NULL', 'None', …) per column."""
    def is_null_series(s: pd.Series) -> pd.Series:
        nan_mask = s.isna()
        string_mask = s.astype("string").str.strip().str.lower().isin(NULL_TOKENS)
        return nan_mask | string_mask.fillna(False)

    per_col = df.apply(is_null_series).sum().astype(int)
    return int(per_col.sum()), per_col


def describe_empty_headers(cols: Iterable[str]) -> list[str]:
    return [c for c in cols if str(c).startswith("Unnamed") or str(c).strip() == ""]


def main() -> int:
    args = parse_args()
    input_path: Path = args.input
    output_path: Path = args.output

    if not input_path.is_file():
        print(f"[ERROR] Missing input CSV: {input_path}", file=sys.stderr)
        return 2
    if not output_path.is_file():
        print(f"[ERROR] Missing output CSV: {output_path}", file=sys.stderr)
        return 2

    input_df = load_csv(input_path)
    output_df = load_csv(output_path)

    row_ok = len(output_df) <= len(input_df)
    total_nulls, per_col_nulls = count_nulls(output_df)
    strict_no_nulls = not args.allow_nulls
    null_ok = total_nulls == 0 if strict_no_nulls else True

    input_empty_headers = describe_empty_headers(input_df.columns)
    output_empty_headers = describe_empty_headers(output_df.columns)
    input_dupes = int(input_df.duplicated().sum())
    output_dupes = int(output_df.duplicated().sum())

    print("=" * 72)
    print("Validation Report — Rhombus AI CSV output checks")
    print("=" * 72)
    print(f"Input path:       {input_path}")
    print(f"Output path:      {output_path}")
    print(f"Input rows:       {len(input_df)}  (duplicates: {input_dupes})")
    print(f"Output rows:      {len(output_df)}  (duplicates: {output_dupes})")
    print(f"Input columns:    {list(input_df.columns)}")
    print(f"Output columns:   {list(output_df.columns)}")
    if input_empty_headers:
        print(f"Input empty/unnamed headers: {input_empty_headers}")
    if output_empty_headers:
        print(f"Output empty/unnamed headers: {output_empty_headers}")
    print("-" * 72)
    print(f"Rule 1 — output rows <= input rows:  {'PASS' if row_ok else 'FAIL'}")
    print(
        "Rule 2 — "
        + ("no nulls allowed in output" if strict_no_nulls else "null check skipped")
    )
    if strict_no_nulls:
        print(f"          total null-like cells: {total_nulls} -> {'PASS' if null_ok else 'FAIL'}")
        if total_nulls:
            print("          per-column null counts:")
            for col, cnt in per_col_nulls.items():
                if int(cnt) > 0:
                    print(f"            - {col}: {int(cnt)}")
    print("=" * 72)

    if not row_ok:
        print("[RESULT] FAIL — output has more rows than input.", file=sys.stderr)
        return 1
    if not null_ok:
        print("[RESULT] FAIL — output still contains null-like values.", file=sys.stderr)
        return 1

    print("[RESULT] PASS — row-count and null checks succeeded.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
