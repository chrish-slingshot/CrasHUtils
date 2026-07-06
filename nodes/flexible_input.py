"""Flexible optional inputs for dynamic widget keys (based on rgthree-comfy pattern)."""


class AnyType(str):
    def __ne__(self, __value: object) -> bool:
        return False


class FlexibleOptionalInputType(dict):
    def __init__(self, type, data=None):
        self.type = type
        self.data = data
        if self.data is not None:
            for k, v in self.data.items():
                self[k] = v

    def __getitem__(self, key):
        if self.data is not None and key in self.data:
            return self.data[key]
        return (self.type,)

    def __contains__(self, key):
        return True


any_type = AnyType("*")
