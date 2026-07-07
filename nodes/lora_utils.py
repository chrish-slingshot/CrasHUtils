import json
import os
import re

import folder_paths

_TRIGGER_PREFIXES = {"trigger", "triggers", "prompt", "tags", "tag"}
_TRIGGER_SPLIT_RE = re.compile(r"[,;\t|]+")


def normalize_lora_path(path: str) -> str:
    return path.replace("\\", "/")


def _resolve_lora_full_path(lora_relative_path: str) -> str | None:
    lora_relative_path = normalize_lora_path(lora_relative_path.strip("/\\"))
    if not lora_relative_path:
        return None

    try:
        full_path = folder_paths.get_full_path("loras", lora_relative_path)
        if full_path and os.path.isfile(full_path):
            return full_path
    except Exception:
        pass

    for root in folder_paths.get_folder_paths("loras"):
        candidate = os.path.normpath(os.path.join(root, lora_relative_path.replace("/", os.sep)))
        if os.path.isfile(candidate):
            return candidate

    resolved = get_lora_by_filename(lora_relative_path)
    if not resolved:
        return None

    resolved = normalize_lora_path(resolved)
    try:
        full_path = folder_paths.get_full_path("loras", resolved)
        if full_path and os.path.isfile(full_path):
            return full_path
    except Exception:
        pass

    for root in folder_paths.get_folder_paths("loras"):
        candidate = os.path.normpath(os.path.join(root, resolved.replace("/", os.sep)))
        if os.path.isfile(candidate):
            return candidate

    return None


def _find_trigger_txt_path(full_path: str) -> str | None:
    candidates = [
        f"{os.path.splitext(full_path)[0]}.txt",
        f"{full_path}.txt",
    ]

    for candidate in candidates:
        if os.path.isfile(candidate):
            return candidate

    directory = os.path.dirname(full_path)
    stem = os.path.splitext(os.path.basename(full_path))[0]
    try:
        for entry in os.scandir(directory):
            if not entry.is_file():
                continue
            if not entry.name.lower().endswith(".txt"):
                continue
            entry_stem = os.path.splitext(entry.name)[0]
            if entry_stem.casefold() == stem.casefold():
                return entry.path
            if entry_stem.casefold() == os.path.basename(full_path).casefold():
                return entry.path
    except OSError:
        pass

    return None


def _read_text_file(path: str) -> str | None:
    for encoding in ("utf-8-sig", "utf-8", "utf-16", "utf-16-le", "utf-16-be", "cp1252", "latin-1"):
        try:
            with open(path, encoding=encoding) as handle:
                return handle.read()
        except (OSError, UnicodeDecodeError, UnicodeError):
            continue

    try:
        with open(path, encoding="utf-8", errors="replace") as handle:
            return handle.read()
    except OSError:
        return None


def parse_trigger_content(content: str) -> list[str]:
    """Parse trigger words from file content, preserving punctuation and spaces."""
    if not content:
        return []

    terms: list[str] = []
    seen: set[str] = set()

    for line in content.splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue

        if ":" in line and not line.lower().startswith("http"):
            prefix, _, remainder = line.partition(":")
            if prefix.strip().casefold() in _TRIGGER_PREFIXES:
                line = remainder.strip()
                if not line:
                    continue

        if _TRIGGER_SPLIT_RE.search(line):
            parts = _TRIGGER_SPLIT_RE.split(line)
        else:
            parts = [line]

        for part in parts:
            term = part.strip().strip('"').strip("'")
            if not term:
                continue
            key = term.casefold()
            if key in seen:
                continue
            seen.add(key)
            terms.append(term)

    return terms


def _dedupe_terms(terms: list[str]) -> list[str]:
    result: list[str] = []
    seen: set[str] = set()
    for term in terms:
        if not term:
            continue
        key = str(term).casefold()
        if key in seen:
            continue
        seen.add(key)
        result.append(str(term))
    return result


def _read_rgthree_triggers(full_path: str) -> list[str]:
    sidecar = f"{full_path}.rgthree-info.json"
    if not os.path.isfile(sidecar):
        return []

    try:
        with open(sidecar, encoding="utf-8") as handle:
            data = json.load(handle)
    except (OSError, json.JSONDecodeError, UnicodeError):
        return []

    if not isinstance(data, dict):
        return []

    terms: list[str] = []
    for item in data.get("trainedWords") or []:
        if isinstance(item, dict):
            if item.get("civitai") and item.get("word"):
                terms.append(str(item["word"]))
        elif isinstance(item, str):
            terms.append(item)

    civitai = data.get("civitai")
    if isinstance(civitai, dict):
        for item in civitai.get("trainedWords") or []:
            if isinstance(item, str):
                terms.append(item)
            elif isinstance(item, dict) and item.get("word"):
                terms.append(str(item["word"]))

    return _dedupe_terms(terms)


def get_lora_triggers_from_full_path(full_path: str) -> list[str]:
    """Read trigger keywords using a known on-disk LoRA path."""
    if not full_path or not os.path.isfile(full_path):
        return []

    txt_path = _find_trigger_txt_path(full_path)
    if txt_path is not None:
        content = _read_text_file(txt_path)
        if content is not None:
            terms = parse_trigger_content(content)
            if terms:
                return terms

    return _read_rgthree_triggers(full_path)


def get_lora_by_filename(file_path: str, lora_paths=None) -> str | None:
    lora_paths = lora_paths if lora_paths is not None else folder_paths.get_filename_list("loras")
    file_path = normalize_lora_path(file_path)
    normalized_paths = [normalize_lora_path(x) for x in lora_paths]

    if file_path in normalized_paths:
        return normalize_lora_path(lora_paths[normalized_paths.index(file_path)])

    file_path_no_ext = os.path.splitext(file_path)[0]
    normalized_paths_no_ext = [os.path.splitext(x)[0] for x in normalized_paths]
    if file_path_no_ext in normalized_paths_no_ext:
        return normalize_lora_path(lora_paths[normalized_paths_no_ext.index(file_path_no_ext)])

    file_name = os.path.basename(file_path)
    file_name_no_ext = os.path.splitext(file_name)[0]
    for lora_path in lora_paths:
        normalized = normalize_lora_path(lora_path)
        if os.path.basename(normalized) == file_name:
            return normalized
        if os.path.splitext(os.path.basename(normalized))[0] == file_name_no_ext:
            return normalized

    return None


LORA_PREVIEW_EXTENSIONS = (".png", ".webp", ".jpg", ".jpeg", ".gif", ".bmp")


def find_lora_preview_path(full_path: str | None) -> str | None:
    if not full_path:
        return None

    base, _ = os.path.splitext(full_path)
    for ext in LORA_PREVIEW_EXTENSIONS:
        candidate = f"{base}{ext}"
        if os.path.isfile(candidate):
            return candidate
    return None


def lora_has_preview(lora_relative_path: str, *, full_path: str | None = None) -> bool:
    if full_path is None:
        full_path = _resolve_lora_full_path(lora_relative_path)
    return find_lora_preview_path(full_path) is not None


def get_lora_triggers(lora_relative_path: str = "", *, full_path: str | None = None) -> list[str]:
    """Read trigger keywords from a companion .txt file alongside the LoRA."""
    if full_path and os.path.isfile(full_path):
        return get_lora_triggers_from_full_path(full_path)

    if not lora_relative_path:
        return []

    resolved = _resolve_lora_full_path(lora_relative_path)
    if resolved is None:
        return []

    return get_lora_triggers_from_full_path(resolved)
