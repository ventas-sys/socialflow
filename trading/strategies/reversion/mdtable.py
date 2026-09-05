"""Tabla markdown sin dependencias externas."""
def md_table(df_or_rows, cols=None, floatfmt=".2f"):
    import pandas as pd
    if isinstance(df_or_rows, pd.DataFrame):
        cols = cols or list(df_or_rows.columns)
        rows = df_or_rows[cols].to_dict('records')
    else:
        rows = df_or_rows; cols = cols or list(rows[0].keys())
    def fmt(v):
        if isinstance(v, float): return format(v, floatfmt)
        return str(v)
    out = ["| " + " | ".join(cols) + " |", "|" + "|".join("---" for _ in cols) + "|"]
    for r in rows: out.append("| " + " | ".join(fmt(r[c]) for c in cols) + " |")
    return "\n".join(out)
