import os
from nodes import EXTENSION_WEB_DIRS
from server import PromptServer

from .nodes import NODE_CLASS_MAPPINGS, NODE_DISPLAY_NAME_MAPPINGS
from .lora_browser import register_routes

__version__ = "1.0.2"

EXTENSION_WEB_DIRS["crash-utils"] = os.path.join(os.path.dirname(os.path.realpath(__file__)), 'js')

if getattr(PromptServer, "instance", None) is not None:
    register_routes(PromptServer.instance.routes)

__all__ = ['NODE_CLASS_MAPPINGS', 'NODE_DISPLAY_NAME_MAPPINGS']