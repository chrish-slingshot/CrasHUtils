import torch
import random
from torchvision.transforms.functional import to_pil_image, to_tensor
from PIL import ImageEnhance, Image, ImageChops

class ImageGlitcher:
    """
    Apply a glitch effect on the input image.
    """

    def __init__(self):
        pass

    @classmethod
    def INPUT_TYPES(s):
        """
        Input: image, glitch_mount, brightness, scanlines
        """
        return {
            "required": {
                "image": ("IMAGE",),
                "glitchiness": ("INT", {
                    "default": 2,
                    "min": 0,
                    "max": 10,
                    "step": 1,
                    "display": "slider"
                }),
                "brightness": ("INT", {
                    "default": 0,
                    "min": 0,
                    "max": 10,
                    "step": 1,
                    "display": "slider"
                }),
                "seed": ("INT", {"default": 0, "min": 0, "max": 0xffffffffffffffff}),
                "scanlines": (["enable", "disable"],)
            },
        }

    RETURN_TYPES = ("IMAGE",)
    FUNCTION = "applyGlitch"
    OUTPUT_NODE = False
    CATEGORY = "Effects"

    def applyGlitch(self, image, glitchiness, brightness, scanlines, seed):
        # Since the glitchImage method isn't provided, 
        # I'm just adding a placeholder for the logic.
        # In a real scenario, you'd call glitchImage and pass the required parameters.
        glitched_image = self.glitchImage(image, glitchiness, brightness, scanlines == "enable", seed)
        return (glitched_image,)

    
    def glitchImage(self, tensor, glitch_amount, brightness_amount, use_scanlines, seed):
        random.seed(seed)
        
        # Ensure the tensor is of shape (B, H, W, C)
        tensor = tensor.squeeze(0).permute(0, 1, 2).cpu().numpy()
        img = Image.fromarray((tensor * 255).astype('uint8'))
        
        iw, ih = img.size
        max_offset = int(glitch_amount * glitch_amount / 100 * iw)
        
        # Create output image and input image copies
        output_img = img.copy()
        input_img = img.copy()

        # Randomly offset slices horizontally
        for _ in range(glitch_amount * 2):
            startY = random.randint(0, ih)
            chunk_height = random.randint(1, ih // 4)
            chunk_height = min(chunk_height, ih - startY)
            offset = random.randint(-max_offset, max_offset)

            if offset == 0:
                continue

            # Left shift and wrap-around
            if offset < 0:
                output_img.paste(input_img.crop((0, startY, iw + offset, startY + chunk_height)), (0, startY))
                output_img.paste(input_img.crop((iw + offset, startY, iw, startY + chunk_height)), (0, startY))
            else:
                # Right shift and wrap-around
                output_img.paste(input_img.crop((offset, startY, iw, startY + chunk_height)), (0, startY))
                output_img.paste(input_img.crop((0, startY, offset, startY + chunk_height)), (iw - offset, startY))

        # Color Offset
        channel_to_offset = self.get_random_channel()
        offset_x = random.randint(-glitch_amount * 2, glitch_amount * 2)
        offset_y = random.randint(-glitch_amount * 2, glitch_amount * 2)
        r, g, b = img.split()
        r2, g2, b2 = output_img.split()
        
        if channel_to_offset == 'R':
            r = ImageChops.offset(r, offset_x, offset_y)
            g = g2
            b = b2
        elif channel_to_offset == 'G':
            r = r2
            g = ImageChops.offset(g, offset_x, offset_y)
            b = b2
        elif channel_to_offset == 'B':
            r = r2
            g = g2
            b = ImageChops.offset(b, offset_x, offset_y)
        output_img = Image.merge("RGB", (r, g, b))
#        output_img = self.blend_single_channel(input_img, output_img, channel_to_offset, 0)

        # Brightness
        enhancer = ImageEnhance.Brightness(output_img)
        output_img = enhancer.enhance(1 + brightness_amount / 10)

        # Add Scanlines
        if use_scanlines:
            for i in range(ih):
                if i % 2 == 0:
                    line = Image.new("RGB", (iw, 1), (0, 0, 0))
                    output_img.paste(line, (0, i))

        # Convert back to tensor and maintain (B, H, W, C) format
        glitched_tensor = to_tensor(output_img).unsqueeze(0).permute(0, 2, 3, 1)

        return glitched_tensor

    def get_random_channel(self):
        r = random.random()
        if r < 0.33:
            return 'G'
        elif r < 0.66:
            return 'R'
        else:
            return 'B'

    def blend_single_channel(self, img1, img2, channel_to_blend, alpha=0.5):
        # Ensure both images are in RGB mode
        img1 = img1.convert("RGB")
        img2 = img2.convert("RGB")
        
        # Split both images into their R, G, and B channels
        r1, g1, b1 = img1.split()
        r2, g2, b2 = img2.split()
        
        # Perform blending operation on the chosen channel
        if channel_to_blend == "R":
            blended_r = Image.blend(r1, r2, alpha)
            result = Image.merge("RGB", (blended_r, g1, b1))
        elif channel_to_blend == "G":
            blended_g = Image.blend(g1, g2, alpha)
            result = Image.merge("RGB", (r1, blended_g, b1))
        elif channel_to_blend == "B":
            blended_b = Image.blend(b1, b2, alpha)
            result = Image.merge("RGB", (r1, g1, blended_b))
        else:
            raise ValueError("Invalid channel. Choose from 'R', 'G', or 'B'.")

        return result

# Append to the NODE_CLASS_MAPPINGS dictionary
NODE_CLASS_MAPPINGS = {
    "ImageGlitcher": ImageGlitcher
}

# A dictionary that contains the friendly/humanly readable titles for the nodes
NODE_DISPLAY_NAME_MAPPINGS = {
    "ImageGlitcher": "Image Glitcher"
}