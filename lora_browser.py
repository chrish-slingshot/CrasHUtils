import os
import tempfile

from aiohttp import web
from PIL import Image
from io import BytesIO

import folder_paths

from .lora_info_service import get_lora_info
from .nodes.lora_utils import (
    _resolve_lora_full_path,
    find_lora_preview_path,
    get_lora_triggers,
    lora_has_preview,
    normalize_lora_path,
)

NSFW_FOLDER_NAME = "nsfw"


def _parse_sfw_param(value: str | None) -> bool:
    if value is None:
        return True
    return value.lower() not in ("0", "false", "no", "off")


def _is_nsfw_folder_name(folder_name: str) -> bool:
    return folder_name.lower() == NSFW_FOLDER_NAME


def _is_nsfw_path(relative_path: str) -> bool:
    """True when any folder segment in the path is named NSFW."""
    parts = [p for p in normalize_lora_path(relative_path).split("/") if p]
    return any(part.lower() == NSFW_FOLDER_NAME for part in parts)


def _should_hide_folder(folder_name: str, sfw: bool) -> bool:
    return sfw and _is_nsfw_folder_name(folder_name)


def _get_lora_roots() -> list[str]:
    return folder_paths.get_folder_paths("loras")


def _get_lora_extensions() -> set[str]:
    return folder_paths.folder_names_and_paths["loras"][1]


def _path_within_root(full_path: str, root: str) -> bool:
    try:
        return os.path.commonpath([os.path.normpath(full_path), os.path.normpath(root)]) == os.path.normpath(root)
    except ValueError:
        return False


def _is_safe_relative_path(relative_path: str) -> bool:
    return ".." not in normalize_lora_path(relative_path).split("/")


def _resolve_lora_path(relative_path: str) -> str | None:
    relative_path = normalize_lora_path(relative_path.strip("/\\"))
    if not _is_safe_relative_path(relative_path):
        return None
    return _resolve_lora_full_path(relative_path)


def _resolve_folder_path(relative_path: str) -> str | None:
    relative_path = normalize_lora_path(relative_path.strip("/\\"))
    if not _is_safe_relative_path(relative_path):
        return None
    if not relative_path:
        return None

    for root in _get_lora_roots():
        full = os.path.normpath(os.path.join(root, relative_path.replace("/", os.sep)))
        if _path_within_root(full, root) and os.path.isdir(full):
            return full
    return None


def _relative_lora_path(full_path: str) -> str | None:
    for root in _get_lora_roots():
        root_norm = os.path.normpath(root)
        full_norm = os.path.normpath(full_path)
        if _path_within_root(full_norm, root_norm):
            rel = os.path.relpath(full_norm, root_norm)
            return normalize_lora_path(rel)
    return None


def _build_breadcrumbs(relative_path: str) -> list[dict]:
    crumbs = [{"name": "loras", "path": ""}]
    if not relative_path:
        return crumbs

    parts = [p for p in relative_path.split("/") if p]
    current = ""
    for part in parts:
        current = f"{current}/{part}" if current else part
        crumbs.append({"name": part, "path": current})
    return crumbs


def _lora_entry(name: str, path: str, full_path: str | None = None) -> dict:
    return {
        "name": name,
        "path": path,
        "hasPreview": lora_has_preview(path, full_path=full_path),
        "triggers": get_lora_triggers(path, full_path=full_path),
    }


def _browse_roots_merged(sfw: bool = True) -> dict:
    folders: dict[str, dict] = {}
    loras: dict[str, dict] = {}
    lora_extensions = _get_lora_extensions()

    for root in _get_lora_roots():
        if not os.path.isdir(root):
            continue
        try:
            entries = sorted(os.scandir(root), key=lambda e: (not e.is_dir(), e.name.lower()))
        except OSError:
            continue

        for entry in entries:
            if entry.name.startswith("."):
                continue
            if entry.is_dir():
                if _should_hide_folder(entry.name, sfw):
                    continue
                folders.setdefault(entry.name, {"name": entry.name, "path": entry.name})
                continue

            ext = os.path.splitext(entry.name)[1].lower()
            if ext not in lora_extensions:
                continue

            rel = _relative_lora_path(entry.path)
            if rel is None or (sfw and _is_nsfw_path(rel)):
                continue
            loras[rel] = _lora_entry(os.path.splitext(entry.name)[0], rel, entry.path)

    return {
        "path": "",
        "breadcrumbs": _build_breadcrumbs(""),
        "folders": sorted(folders.values(), key=lambda item: item["name"].lower()),
        "loras": sorted(loras.values(), key=lambda item: item["name"].lower()),
    }


def _browse_folder(relative_path: str, sfw: bool = True) -> dict:
    relative_path = normalize_lora_path(relative_path.strip("/\\"))
    if not relative_path:
        return _browse_roots_merged(sfw)

    if sfw and _is_nsfw_path(relative_path):
        return {"path": relative_path, "breadcrumbs": _build_breadcrumbs(relative_path), "folders": [], "loras": []}

    folder = _resolve_folder_path(relative_path)
    if folder is None:
        return {"path": relative_path, "breadcrumbs": _build_breadcrumbs(relative_path), "folders": [], "loras": []}

    folders = []
    loras = []
    lora_extensions = _get_lora_extensions()

    try:
        entries = sorted(os.scandir(folder), key=lambda e: (not e.is_dir(), e.name.lower()))
    except OSError:
        entries = []

    for entry in entries:
        if entry.name.startswith("."):
            continue
        if entry.is_dir():
            if _should_hide_folder(entry.name, sfw):
                continue
            rel = normalize_lora_path(
                os.path.join(relative_path, entry.name) if relative_path else entry.name
            )
            folders.append({"name": entry.name, "path": rel})
            continue

        ext = os.path.splitext(entry.name)[1].lower()
        if ext not in lora_extensions:
            continue

        rel = _relative_lora_path(entry.path)
        if rel is None or (sfw and _is_nsfw_path(rel)):
            continue
        loras.append(_lora_entry(os.path.splitext(entry.name)[0], rel, entry.path))

    return {
        "path": relative_path,
        "breadcrumbs": _build_breadcrumbs(relative_path),
        "folders": folders,
        "loras": loras,
    }


def _search_loras(relative_path: str, query: str, sfw: bool = True) -> list[dict]:
    query = query.strip().lower()
    if not query:
        return []

    prefix = normalize_lora_path(relative_path.strip("/\\"))
    if prefix and not prefix.endswith("/"):
        prefix = f"{prefix}/"

    results = []
    seen = set()
    for lora_path in folder_paths.get_filename_list("loras"):
        normalized = normalize_lora_path(lora_path)
        if sfw and _is_nsfw_path(normalized):
            continue
        if prefix and not normalized.startswith(prefix):
            continue

        name_no_ext = os.path.splitext(os.path.basename(normalized))[0]
        if query not in name_no_ext.lower() and query not in normalized.lower():
            continue
        if normalized in seen:
            continue
        seen.add(normalized)

        folder_rel = normalize_lora_path(os.path.dirname(normalized))
        results.append({
            **_lora_entry(name_no_ext, normalized),
            "folder": folder_rel if folder_rel != "." else "",
        })

    results.sort(key=lambda item: item["name"].lower())
    return results


def _find_preview_image(lora_relative_path: str) -> str | None:
    full_path = _resolve_lora_path(lora_relative_path)
    return find_lora_preview_path(full_path)


def _preview_cache_headers(source_path: str) -> dict[str, str]:
    stat = os.stat(source_path)
    etag = f'"{int(stat.st_mtime_ns)}-{stat.st_size}"'
    return {
        "ETag": etag,
        "Cache-Control": "public, max-age=604800",
    }


def _resolve_view_image_path(filename: str, folder_type: str, subfolder: str = "") -> str | None:
    filename, output_dir = folder_paths.annotated_filepath(filename)
    if not filename or filename[0] == "/" or ".." in filename:
        return None

    if output_dir is None:
        output_dir = folder_paths.get_directory_by_type(folder_type)
    if not output_dir:
        return None

    output_dir = os.path.normpath(output_dir)
    subfolder = normalize_lora_path(subfolder.strip("/\\"))
    if subfolder:
        full_output_dir = os.path.normpath(os.path.join(output_dir, subfolder.replace("/", os.sep)))
        try:
            if os.path.commonpath([full_output_dir, output_dir]) != output_dir:
                return None
        except ValueError:
            return None
        output_dir = full_output_dir

    file_path = os.path.join(output_dir, os.path.basename(filename))
    return file_path if os.path.isfile(file_path) else None


def _save_lora_thumbnail(source_path: str, lora_relative_path: str) -> dict:
    lora_full = _resolve_lora_full_path(lora_relative_path)
    if lora_full is None:
        return {"error": "LoRA file not found"}

    if not source_path or not os.path.isfile(source_path):
        return {"error": "Source image not found"}

    dest = f"{os.path.splitext(lora_full)[0]}.png"
    dest_dir = os.path.dirname(dest)
    tmp_path = None
    try:
        with Image.open(source_path) as img:
            if img.mode not in ("RGB", "RGBA"):
                img = img.convert("RGBA")
            fd, tmp_path = tempfile.mkstemp(suffix=".png", dir=dest_dir)
            os.close(fd)
            img.save(tmp_path, format="PNG")
        os.replace(tmp_path, dest)
        tmp_path = None
    except OSError as exc:
        if tmp_path and os.path.isfile(tmp_path):
            try:
                os.remove(tmp_path)
            except OSError:
                pass
        return {"error": f"Failed to save thumbnail: {exc}"}

    rel = _relative_lora_path(lora_full) or normalize_lora_path(lora_relative_path)
    return {"ok": True, "path": dest, "lora_path": rel}


def register_routes(routes):
    @routes.get("/crashutils/loras/browse")
    async def browse_loras(request):
        path = normalize_lora_path(request.rel_url.query.get("path", ""))
        sfw = _parse_sfw_param(request.rel_url.query.get("sfw"))
        return web.json_response(_browse_folder(path, sfw=sfw))

    @routes.get("/crashutils/loras/search")
    async def search_loras(request):
        path = normalize_lora_path(request.rel_url.query.get("path", ""))
        query = request.rel_url.query.get("q", "")
        sfw = _parse_sfw_param(request.rel_url.query.get("sfw"))
        return web.json_response({"loras": _search_loras(path, query, sfw=sfw)})

    @routes.get("/crashutils/loras/preview")
    async def preview_lora(request):
        path = normalize_lora_path(request.rel_url.query.get("path", ""))
        preview = _find_preview_image(path)
        if preview is None:
            return web.Response(status=404)

        try:
            cache_headers = _preview_cache_headers(preview)
            if request.headers.get("If-None-Match") == cache_headers["ETag"]:
                return web.Response(status=304, headers=cache_headers)

            with Image.open(preview) as img:
                img_bytes = BytesIO()
                img.save(img_bytes, format="WEBP")
                img_bytes.seek(0)
                return web.Response(
                    body=img_bytes.getvalue(),
                    content_type="image/webp",
                    headers=cache_headers,
                )
        except Exception:
            return web.Response(status=404)

    @routes.get("/crashutils/loras/triggers")
    async def lora_triggers(request):
        path = normalize_lora_path(request.rel_url.query.get("path", ""))
        return web.json_response({"triggers": get_lora_triggers(path)})

    @routes.get("/crashutils/loras/info")
    async def lora_info(request):
        path = normalize_lora_path(request.rel_url.query.get("path", ""))
        return web.json_response(get_lora_info(path, fetch_civitai=False))

    @routes.get("/crashutils/loras/info/refresh")
    async def lora_info_refresh(request):
        path = normalize_lora_path(request.rel_url.query.get("path", ""))
        return web.json_response(get_lora_info(path, fetch_civitai=True, force_civitai=True))

    @routes.post("/crashutils/loras/save-thumbnail")
    async def save_lora_thumbnail(request):
        try:
            data = await request.json()
        except Exception:
            return web.json_response({"error": "Invalid request body"}, status=400)

        if not isinstance(data, dict):
            return web.json_response({"error": "Invalid request body"}, status=400)

        filename = data.get("filename", "")
        folder_type = data.get("type", "temp")
        subfolder = normalize_lora_path(str(data.get("subfolder", "")))
        lora_path = normalize_lora_path(data.get("lora_path", ""))

        if not filename or not lora_path:
            return web.json_response({"error": "Missing filename or lora_path"}, status=400)

        source = _resolve_view_image_path(filename, folder_type, subfolder)
        if source is None:
            return web.json_response({"error": "Source image not found"}, status=404)

        result = _save_lora_thumbnail(source, lora_path)
        if "error" in result:
            return web.json_response(result, status=404 if "not found" in result["error"].lower() else 500)
        return web.json_response(result)

    @routes.get("/crashutils/loras/roots")
    async def lora_roots(request):
        return web.json_response({"roots": _get_lora_roots()})
