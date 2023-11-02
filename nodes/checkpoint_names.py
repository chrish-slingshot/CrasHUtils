import folder_paths

class CheckpointNames:
    NAME = "Checkpoint Names"
    
    def __init__(self):
        pass

    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                "ckpt_name": ("ckpt_name", folder_paths.get_filename_list("checkpoints"), "CKPT_NAME"),
            }
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("name",)
    FUNCTION = "getCheckpoints"
    OUTPUT_NODE = False
    CATEGORY = "CrasH Utils/Loaders"

    def getCheckpoints(self, checkpoint_name):
        return checkpoint_name