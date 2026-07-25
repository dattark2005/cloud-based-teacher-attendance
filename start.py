"""
+----------------------------------------------------------+
|        Teacher Attendance System -- Master Launcher      |
|                                                          |
|  Usage:                                                  |
|    python start.py          ← start all services          |
|    python start.py --test   ← check imports + run tests   |
+----------------------------------------------------------+
"""

import sys
import run

if __name__ == "__main__":
    if "--test" in sys.argv:
        run.run_tests()
    else:
        run.main()
