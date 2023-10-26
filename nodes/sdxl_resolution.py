from importlib.abc import ResourceLoader

class SdxlResolution:
    NAME = "SDXL Resolution Picker"
    
    def __init__(self):
        pass

    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                "resolution": (
                    [
                        "704x1408",
                        "704x1344",
                        "768x1344",
                        "768x1280",
                        "832x1216",
                        "832x1152",
                        "896x1152",
                        "896x1088",
                        "960x1088",
                        "960x1024",
                        "1024x1024",
                        "1024x960",
                        "1088x960",
                        "1088x896",
                        "1152x896",
                        "1152x832",
                        "1216x832",
                        "1280x768",
                        "1344x768",
                        "1344x704",
                        "1408x704"
                    ], { "default": "1024x1024" })
            },
        }

    RETURN_TYPES = ("SDXL_RESOLUTION",)
    RETURN_NAMES = ("sdxl_resolution",)
    FUNCTION = "getResolution"
    OUTPUT_NODE = False
    CATEGORY = "CrasH Utils/Image"

    def getResolution(self, resolution):
        width, height = map(int, resolution.split('x'))
        sdxl_resolution = (width, height)
        return (sdxl_resolution, )
    
class SdxlResolutionToDimensions:
    NAME = "SDXL Resolution Split"
    
    def __init__(self):
        pass

    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                "sdxl_resolution": ("SDXL_RESOLUTION",),
            },
        }

    RETURN_TYPES = ("INT", "INT",)
    RETURN_NAMES = ("width", "height",)
    FUNCTION = "convertResolution"
    OUTPUT_NODE = False
    CATEGORY = "CrasH Utils/Image"

    def convertResolution(self, sdxl_resolution):
        width, height = sdxl_resolution
        return width, height