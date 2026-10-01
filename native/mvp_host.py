"""Dedicated Native Messaging host. Existing PCE databases are never opened."""
import argparse
import os
import sys
from pathlib import Path
from host import native_loop
from pce.mvp import MvpGateway

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--database', default=str(Path(os.environ.get('LOCALAPPDATA', Path.home())) / 'G2BHelper' / 'mvp.sqlite3'))
    args, _chrome_arguments = parser.parse_known_args()
    gateway = MvpGateway(args.database)
    try:
        if os.name == 'nt':
            import msvcrt
            msvcrt.setmode(sys.stdin.fileno(), os.O_BINARY)
            msvcrt.setmode(sys.stdout.fileno(), os.O_BINARY)
        native_loop(gateway, sys.stdin.buffer, sys.stdout.buffer)
    finally:
        gateway.close()

if __name__ == '__main__':
    main()
