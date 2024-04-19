import requests
import json
from PIL import Image
import base64
import re

class QueryLocalLLM:
    NAME = "Query Local LLM"
    
    def __init__(self):
        pass

    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                "prompt": ("STRING", { "multiline": True, "default": "" }),
                "url": ("STRING", { "multiline": False, "default": "http://127.0.0.1:5000/api/v1/generate" }),
                "context_length": ("INT", { "default": 2048, "min": 512, "max": 4096, "display": "slider" }),
                "seed": ("INT", {"default": 0, "min": 0, "max": 0xffffffffffffffff})
            },
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("generated_text",)
    FUNCTION = "generateText"
    OUTPUT_NODE = False
    CATEGORY = "CrasH Utils/LLM"

    def generateText(self, prompt, url, context_length, seed):
        description = self.call_api(prompt, url, context_length, seed)
        return (description,)

    def call_api(self, prompt_text, url, context_length, seed):
        payload = {
            "messages": [
            { "role": "system", "content": "You are an assistant designed to create more imaginative and beautiful images by expanding on the image prompt a user gives you. Respond only with your expanded prompt text. Here is the user's prompt:" },
            { "role": "user", "content": f"{prompt_text}\n" }],
            "max_tokens": 300,
            "temperature": 0.7,
            "top_p": 0.95,
            "seed": seed
        }
        
        # Sending the POST request
        response = requests.post(url, json=payload)
        
        # Checking for successful response
        if response.status_code == 200:
            result_json = response.json()

            generatedText = result_json["choices"][0]["message"]["content"]
            
            print("Response: " + generatedText)

            return generatedText
        else:
            print(f"Error {response.status_code}: {response.text}")
            return None

class ExtractCharacterInfo:
    NAME = "Extract Character Information"
    
    def __init__(self):
        pass

    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                "path": ("STRING", { "multiline": False, "default": "" }),
            },
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("character_data",)
    FUNCTION = "parse_png_text"
    OUTPUT_NODE = False
    CATEGORY = "CrasH Utils/LLM"
    
    def parse_png_text(self, path):
        # Open the image file
        with Image.open(path) as img:
            # PNG images can have multiple text chunks, get them all
            text_chunks = [chunk for chunk in img.text.values()]

            # If there are no text chunks, raise an error
            if not text_chunks:
                raise ValueError('No text data found in PNG image.')

            # Decode the first text chunk from base64 to utf-8
            try:
                # This assumes the text is base64-encoded as in the JS example
                decoded_text = base64.b64decode(text_chunks[0]).decode('utf-8')
                print(decoded_text)
                return decoded_text
            except Exception as e:
                raise ValueError('Could not decode the text chunk.') from e