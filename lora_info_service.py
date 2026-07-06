import hashlib
import json
import os
import re
from datetime import datetime
from urllib.parse import quote

import folder_paths
import requests

from .nodes.lora_utils import (
    _resolve_lora_full_path,
    get_lora_triggers,
    lora_has_preview,
    normalize_lora_path,
)

CIVITAI_API = "https://civitai.com/api/v1/model-versions/by-hash/{hash}"
CACHE_DIR_NAME = "crashutils_lora_info"


def _cache_dir() -> str:
    path = os.path.join(folder_paths.get_user_directory(), CACHE_DIR_NAME)
    os.makedirs(path, exist_ok=True)
    return path


def _cache_path(file_hash: str, kind: str) -> str:
    return os.path.join(_cache_dir(), f"{file_hash}.{kind}.json")


def _read_cache(file_hash: str, kind: str) -> dict | None:
    path = _cache_path(file_hash, kind)
    if not os.path.isfile(path):
        return None
    try:
        with open(path, encoding="utf-8") as handle:
            return json.load(handle)
    except (OSError, json.JSONDecodeError):
        return None


def _write_cache(file_hash: str, kind: str, payload: dict) -> None:
    path = _cache_path(file_hash, kind)
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=2)


def _resolve_lora_path(relative_path: str) -> str | None:
    relative_path = normalize_lora_path(relative_path.strip("/\\"))
    if ".." in relative_path.split("/"):
        return None
    return _resolve_lora_full_path(relative_path)


def _sha256_file(file_path: str) -> str | None:
    if not file_path or not os.path.isfile(file_path):
        return None
    digest = hashlib.sha256()
    with open(file_path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 128), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _read_safetensors_metadata(file_path: str) -> dict:
    if not file_path.endswith(".safetensors"):
        return {}
    try:
        with open(file_path, "rb") as handle:
            header_size = int.from_bytes(handle.read(8), "little", signed=False)
            if header_size <= 0:
                return {}
            header = json.loads(handle.read(header_size))
            metadata = header.get("__metadata__", {})
            if not isinstance(metadata, dict):
                return {}
            parsed = {}
            for key, value in metadata.items():
                if isinstance(value, str) and value.startswith("{") and value.endswith("}"):
                    try:
                        parsed[key] = json.loads(value)
                    except json.JSONDecodeError:
                        parsed[key] = value
                else:
                    parsed[key] = value
            return parsed
    except (OSError, json.JSONDecodeError, KeyError, ValueError):
        return {}


def _split_words(value) -> list[str]:
    if value is None:
        return []
    if isinstance(value, list):
        words = []
        for item in value:
            words.extend(_split_words(item))
        return words
    text = str(value).strip()
    if not text:
        return []
    text = re.sub(r"\s*,\s*", ",", text)
    return [part.strip() for part in text.split(",") if part.strip()]


def _word_entries(words: list[str], *, civitai=False, user=False) -> list[dict]:
    entries = []
    seen = set()
    for word in words:
        key = word.casefold()
        if key in seen:
            continue
        seen.add(key)
        entry = {"word": word}
        if civitai:
            entry["civitai"] = True
        if user:
            entry["user"] = True
        entries.append(entry)
    return entries


def _merge_word_entries(existing: list[dict], new_words: list[str], *, civitai=False, user=False) -> list[dict]:
    merged = list(existing or [])
    known = {item.get("word", "").casefold() for item in merged}
    for word in new_words:
        key = word.casefold()
        if key in known:
            for item in merged:
                if item.get("word", "").casefold() == key:
                    if civitai:
                        item["civitai"] = True
                    if user:
                        item["user"] = True
            continue
        entry = {"word": word}
        if civitai:
            entry["civitai"] = True
        if user:
            entry["user"] = True
        merged.append(entry)
        known.add(key)
    return merged


def _fetch_civitai_data(file_hash: str, refresh: bool = False) -> dict | None:
    cached = _read_cache(file_hash, "civitai")
    if cached and not refresh and "response" in cached:
        response = cached["response"]
        if isinstance(response, dict):
            response = dict(response)
            response["_sha256"] = file_hash
            return response

    api_url = CIVITAI_API.format(hash=file_hash)
    try:
        result = requests.get(api_url, timeout=10)
        data = result.json()
    except (requests.RequestException, json.JSONDecodeError):
        if cached and "response" in cached:
            return cached["response"]
        return {"error": "Failed to fetch CivitAI data"}

    if isinstance(data, dict) and data.get("error"):
        payload = {"error": data.get("message") or data.get("error") or "Model not found"}
    else:
        payload = data if isinstance(data, dict) else {"error": "Invalid CivitAI response"}

    _write_cache(
        file_hash,
        "civitai",
        {"url": api_url, "timestamp": datetime.now().timestamp(), "response": payload},
    )

    if "error" not in payload:
        payload = dict(payload)
        payload["_sha256"] = file_hash
    return payload


def _apply_civitai(info: dict, civitai: dict) -> None:
    if not civitai or "error" in civitai:
        info.setdefault("raw", {})["civitai"] = civitai
        return

    model_name = civitai.get("model", {}).get("name")
    version_name = civitai.get("name")
    if model_name:
        info["name"] = model_name if not version_name else f"{model_name} ({version_name})"
    elif version_name:
        info["name"] = version_name

    info["type"] = civitai.get("model", {}).get("type") or info.get("type")
    info["baseModel"] = civitai.get("baseModel") or info.get("baseModel")
    info["sha256"] = civitai.get("_sha256") or info.get("sha256")

    civitai_words = _split_words(civitai.get("triggerWords")) + _split_words(civitai.get("trainedWords"))
    info["trainedWords"] = _merge_word_entries(info.get("trainedWords", []), civitai_words, civitai=True)

    links = list(info.get("links") or [])
    model_id = civitai.get("modelId")
    if model_id:
        link = f"https://civitai.com/models/{model_id}"
        version_id = civitai.get("id")
        if version_id:
            link += f"?modelVersionId={version_id}"
        if link not in links:
            links.append(link)
    info["links"] = links

    images = list(info.get("images") or [])
    existing_urls = {img.get("url") for img in images if isinstance(img, dict)}
    for img in civitai.get("images") or []:
        if not isinstance(img, dict):
            continue
        url = img.get("url")
        if not url or url in existing_urls:
            continue
        img_id = img.get("id")
        images.append(
            {
                "url": url,
                "type": img.get("type"),
                "civitaiUrl": f"https://civitai.com/images/{img_id}" if img_id else None,
            }
        )
        existing_urls.add(url)
    info["images"] = images
    info.setdefault("raw", {})["civitai"] = civitai


def get_lora_info(relative_path: str, *, fetch_civitai: bool = False, force_civitai: bool = False) -> dict:
    relative_path = normalize_lora_path(relative_path)
    full_path = _resolve_lora_path(relative_path)
    if full_path is None:
        return {"file": relative_path, "error": "LoRA file not found"}

    name = os.path.splitext(os.path.basename(relative_path))[0]
    file_hash = _sha256_file(full_path)
    metadata = _read_safetensors_metadata(full_path)
    txt_triggers = get_lora_triggers(relative_path)

    info = {
        "file": relative_path,
        "name": metadata.get("ss_output_name") or name,
        "sha256": file_hash,
        "type": metadata.get("modelspec.architecture") or metadata.get("ss_base_model_version"),
        "baseModel": metadata.get("ss_base_model_version") or metadata.get("modelspec.title"),
        "links": [],
        "trainedWords": _word_entries(txt_triggers, user=True),
        "triggers": txt_triggers,
        "images": [],
        "raw": {"metadata": metadata or None},
        "hasPreview": lora_has_preview(relative_path),
    }

    if info["hasPreview"]:
        info["images"].append({"url": f"/crashutils/loras/preview?path={quote(relative_path, safe='')}"})

    if metadata.get("ss_clip_skip") and metadata.get("ss_clip_skip") != "None":
        info["clipSkip"] = metadata.get("ss_clip_skip")

    if file_hash and (force_civitai or (fetch_civitai and "civitai" not in info.get("raw", {}))):
        civitai = _fetch_civitai_data(file_hash, refresh=force_civitai)
        if civitai:
            _apply_civitai(info, civitai)

    return info
