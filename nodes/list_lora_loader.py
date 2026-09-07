from nodes import LoraLoader

from .flexible_input import FlexibleOptionalInputType, any_type
from .grid_lora_loader import GridLoraLoader


class ListLoraLoader(GridLoraLoader):
    """Multi-LoRA loader with a vertical list browser UI."""

    NAME = "ListLoraLoader"

    CATEGORY = "CrasH Utils/Loaders"
    DESCRIPTION = (
        "Visual LoRA loader with folder browser and vertical list view. "
        "Each LoRA shows a thumbnail, name, and trigger keywords. "
        "Select multiple LoRAs, toggle each individually, and set per-LoRA strength. "
        "Outputs trigger keywords from the primary .txt file plus optional variant .txt files "
        "(e.g. lora1.Character Name.txt) selected in the LoRA settings dialog."
    )

    @classmethod
    def INPUT_TYPES(cls):
        return GridLoraLoader.INPUT_TYPES()

    load_loras = GridLoraLoader.load_loras
