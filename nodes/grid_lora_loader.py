from nodes import LoraLoader

from .flexible_input import FlexibleOptionalInputType, any_type
from .lora_utils import (
    get_lora_by_filename,
    get_lora_triggers,
    get_lora_variant_triggers_from_full_path,
    normalize_lora_path,
    _resolve_lora_full_path,
)


class GridLoraLoader:
    """Multi-LoRA loader with a visual grid browser UI."""

    NAME = "GridLoraLoader"

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {},
            "optional": FlexibleOptionalInputType(
                type=any_type,
                data={
                    "model": ("MODEL",),
                    "clip": ("CLIP",),
                },
            ),
            "hidden": {},
        }

    RETURN_TYPES = ("MODEL", "CLIP", "STRING")
    RETURN_NAMES = ("MODEL", "CLIP", "triggers")
    OUTPUT_TOOLTIPS = (
        "The modified diffusion model.",
        "The modified CLIP model.",
        "Comma-separated trigger keywords from companion .txt files for enabled LoRAs. "
        "Only tags toggled on in the Trigger Tags panel are included.",
    )
    FUNCTION = "load_loras"
    CATEGORY = "CrasH Utils/Loaders"
    DESCRIPTION = (
        "Visual LoRA loader with folder browser and thumbnail grid. "
        "Select multiple LoRAs, toggle each individually, and set per-LoRA strength. "
        "Outputs trigger keywords from companion .txt files (same name as the LoRA)."
    )

    @staticmethod
    def _sorted_lora_items(kwargs):
        items = []
        for key, value in kwargs.items():
            if not key.lower().startswith("lora_") or not isinstance(value, dict):
                continue
            if "on" not in value or "lora" not in value or "strength" not in value:
                continue
            suffix = key.lower().removeprefix("lora_")
            sort_key = int(suffix) if suffix.isdigit() else 0
            items.append((sort_key, key, value))
        items.sort(key=lambda item: item[0])
        return items

    def load_loras(self, model=None, clip=None, **kwargs):
        trigger_terms = []
        seen_triggers = set()

        for _, _, value in self._sorted_lora_items(kwargs):
            strength_model = value["strength"]
            strength_clip = value.get("strengthTwo", strength_model)
            if clip is None:
                strength_clip = 0

            enabled = value["on"] and (strength_model != 0 or strength_clip != 0)
            if not enabled:
                continue

            lora_name = normalize_lora_path(value["lora"])
            lora_file = get_lora_by_filename(lora_name)
            if lora_file is None:
                continue

            for term in self._enabled_trigger_terms(value, lora_file):
                key = term.casefold()
                if key not in seen_triggers:
                    seen_triggers.add(key)
                    trigger_terms.append(term)

            if model is not None:
                model, clip = LoraLoader().load_lora(
                    model, clip, lora_file, strength_model, strength_clip
                )

        return (model, clip, ", ".join(trigger_terms))

    @staticmethod
    def _collect_trigger_terms(value: dict, lora_file: str) -> list[str]:
        full_path = _resolve_lora_full_path(lora_file)
        terms: list[str] = []
        seen: set[str] = set()

        def add_terms(items: list[str]) -> None:
            for term in items:
                if not term:
                    continue
                key = str(term).casefold()
                if key in seen:
                    continue
                seen.add(key)
                terms.append(str(term))

        add_terms(get_lora_triggers(lora_file, full_path=full_path))

        variant_states = value.get("variantStates")
        if isinstance(variant_states, list) and full_path:
            for item in variant_states:
                if not isinstance(item, dict):
                    continue
                if not item.get("on"):
                    continue
                variant_id = item.get("id")
                if not variant_id:
                    continue
                add_terms(get_lora_variant_triggers_from_full_path(full_path, str(variant_id)))

        return terms

    @staticmethod
    def _enabled_trigger_terms(value: dict, lora_file: str) -> list[str]:
        trigger_states = value.get("triggerStates")
        if isinstance(trigger_states, list):
            terms = []
            for item in trigger_states:
                if not isinstance(item, dict):
                    continue
                if not item.get("on"):
                    continue
                word = item.get("word")
                if word:
                    terms.append(str(word))
            if terms or trigger_states:
                return terms

        triggers = value.get("triggers")
        if isinstance(triggers, list) and triggers:
            return [str(term) for term in triggers if term]

        return GridLoraLoader._collect_trigger_terms(value, lora_file)
