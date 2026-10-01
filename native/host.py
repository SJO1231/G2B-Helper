"""Chrome Native Messaging entrypoint; stdout contains framed messages only."""
import argparse
import os
import struct
import sys
from pathlib import Path
from pce.gateway import Gateway
from pce.model import loads, dumps


def default_database():
    return Path(os.environ.get('LOCALAPPDATA', Path.home() / '.local' / 'share')) / 'PCE' / 'pce.sqlite3'


def read_exact(stream, length):
    result = b''
    while len(result) < length:
        chunk = stream.read(length - len(result))
        if not chunk:
            if not result:
                return None
            raise EOFError('Truncated native frame')
        result += chunk
    return result


def response_frames(response, chunk_size=60000):
    encoded = dumps(response)
    if len(encoded.encode('utf-8')) < 750000:
        return [response]
    chunks = [encoded[i:i + chunk_size] for i in range(0, len(encoded), chunk_size)]
    return [{'protocolVersion': 1, 'requestId': response['requestId'], 'chunk': {'index': i, 'total': len(chunks), 'text': text}} for i, text in enumerate(chunks)]


def native_loop(gateway, input_stream, output_stream):
    while True:
        header = read_exact(input_stream, 4)
        if header is None:
            return
        size = struct.unpack('<I', header)[0]
        if size > 64 * 1024 * 1024:
            raise ValueError('Native request exceeds 64 MiB')
        payload = read_exact(input_stream, size)
        if payload is None:
            raise EOFError('Missing request body')
        try:
            response = gateway.handle(loads(payload.decode('utf-8')))
        except (ValueError, UnicodeError) as error:
            response = {'protocolVersion': 1, 'requestId': '', 'error': {'code': 'INVALID_JSON', 'message': str(error)}}
        for frame in response_frames(response):
            encoded = dumps(frame).encode('utf-8')
            output_stream.write(struct.pack('<I', len(encoded)))
            output_stream.write(encoded)
            output_stream.flush()


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--database', default=str(default_database()))
    args, chrome_arguments = parser.parse_known_args()
    native_loop(Gateway(args.database), sys.stdin.buffer, sys.stdout.buffer)
