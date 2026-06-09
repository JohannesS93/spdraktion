from __future__ import annotations

import json

from main import run_mail_import_once


if __name__ == "__main__":
    result = run_mail_import_once()
    print(json.dumps(result, ensure_ascii=True, indent=2))
