"""Resolve the real Windows Downloads Known Folder, including redirected profiles."""
import os
import uuid
import ctypes
from pathlib import Path

def downloads_folder():
    if os.name != 'nt':
        return Path.home() / 'Downloads'
    guid = (ctypes.c_ubyte * 16).from_buffer_copy(uuid.UUID('374de290-123f-4565-9164-39c4925e467b').bytes_le)
    result = ctypes.c_wchar_p()
    status = ctypes.windll.shell32.SHGetKnownFolderPath(ctypes.byref(guid), 0, None, ctypes.byref(result))
    if status != 0:
        raise OSError('Windows 다운로드 폴더를 찾지 못했습니다. 폴더 설정에서 경로를 지정하세요.')
    try:
        return Path(result.value)
    finally:
        ctypes.windll.ole32.CoTaskMemFree(result)
