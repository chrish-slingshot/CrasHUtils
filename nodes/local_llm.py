import requests
import json

class QueryLocalLLM:
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
    CATEGORY = "Effects"

    def generateText(self, prompt, url, context_length, seed):
        description = self.call_api(prompt, url, context_length, seed)
        return (description,)

    def call_api(self, prompt_text, url, context_length, seed):
        payload = {
            "prompt": f"{prompt_text}\nAssistant: ",
            "use_story": False,
            "use_memory": False,
            "use_authors_note": False,
            "use_world_info": False,
            "max_context_length": context_length,
            "max_length": 300,
            "rep_pen": 1.1,
            "rep_pen_range": 600,
            "rep_pen_slope": 0,
            "temperature": 1,
            "tfs": 1,
            "top_a": 0,
            "top_k": 0,
            "top_p": 0.95,
            "typical": 1,
            "sampler_order": [6, 0, 1, 2, 3, 4, 5],
            "singleline": False,
            "seed": seed
        }
        
        # Sending the POST request
        response = requests.post(url, json=payload)
        
        # Checking for successful response
        if response.status_code == 200:
            result_json = response.json()

            generatedText = result_json["results"][0]["text"]
            
            print("Response: " + generatedText)

            return generatedText
        else:
            print(f"Error {response.status_code}: {response.text}")
            return None

# Append to the NODE_CLASS_MAPPINGS dictionary
NODE_CLASS_MAPPINGS = {
    "QueryLocalLLM": QueryLocalLLM
}

# A dictionary that contains the friendly/humanly readable titles for the nodes
NODE_DISPLAY_NAME_MAPPINGS = {
    "QueryLocalLLM": "Query Local LLM"
}