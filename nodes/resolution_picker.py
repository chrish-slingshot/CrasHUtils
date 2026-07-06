RESOLUTION_OPTIONS = [
    "1440x868",
    "1440x1040",
    "1280x1280",
    "1040x1440",
    "868x1440",
]


class ResolutionPicker:
    """Pick width and height from a fixed list of resolutions."""

    NAME = "ResolutionPicker"

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "resolution": (RESOLUTION_OPTIONS, {"default": "1280x1280"}),
            },
        }

    RETURN_TYPES = ("INT", "INT")
    RETURN_NAMES = ("Width", "Height")
    FUNCTION = "pick"
    CATEGORY = "CrasH Utils/Image"
    DESCRIPTION = "Select a resolution from a list and output width and height."

    def pick(self, resolution):
        width, height = map(int, resolution.split("x"))
        return (width, height)
