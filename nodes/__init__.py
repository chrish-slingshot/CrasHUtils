from .image_glitcher import ImageGlitcher
from .color_stylizer import ColorStylizer
from .local_llm import QueryLocalLLM

NODE_CLASS_MAPPINGS = {
    "ImageGlitcher": ImageGlitcher,
    "ColorStylizer": ColorStylizer,
    "QueryLocalLLM": QueryLocalLLM,
}

# A dictionary that contains the friendly/humanly readable titles for the nodes
NODE_DISPLAY_NAME_MAPPINGS = {
    "ImageGlitcher": "Image Glitcher",
    "ColorStylizer": "Color Stylizer",
    "QueryLocalLLM": "Query Local LLM",
}

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS"]
