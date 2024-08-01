import os
import easy_nodes
easy_nodes.initialize_easy_nodes(default_category="EasyNodes Examples", auto_register=False)

# Simply importing your module gives the ComfyNode decorator a chance to register your nodes.
from .example_nodes import *  # noqa: F403, E402

NODE_CLASS_MAPPINGS, NODE_DISPLAY_NAME_MAPPINGS = easy_nodes.get_node_mappings()
__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS"]

# Optional: export the node list to a file so that e.g. ComfyUI-Manager can pick it up.
easy_nodes.save_node_list(os.path.join(os.path.dirname(__file__), "node_list.json"))
