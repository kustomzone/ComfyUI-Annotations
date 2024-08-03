# Effortless Nodes for ComfyUI

This package aims to make adding new [ComfyUI](https://github.com/comfyanonymous/ComfyUI) nodes as easy as possible, allowing you to write basic annotated Python and automatically turn it into a ComfyUI node definition via a simple `@ComfyNode` annotation.

For example:
```python
from easy_nodes import ComfyNode, ImageTensor, MaskTensor, NumberInput

@ComfyNode(color="#0066cc", bg_color="#ffcc00", return_names=["Below", "Above"])
def threshold_image(image: ImageTensor,
                    threshold: float = NumberInput(0.5, 0, 1, 0.01, display="slider")) -> tuple[MaskTensor, MaskTensor]:
    """Returns separate masks for values above and below the threshold value."""
    mask_below = torch.any(image < threshold, dim=-1)
    return mask_below.float(), (~mask_below).float()
```

That (plus [a tiny bit of initialization](#installation) in `__init__.py`) and your node is ready for ComfyUI!

In addition, it provides enhanced node customization previously only available with custom JavaScript (e.g. color, and adding preview images/text), and several general ComfyUI quality of life improvements.

More examples can be found [here](example/example_nodes.py).

## Features

### Core Functionality
- **@ComfyNode Decorator**: Simplifies custom node declaration with automagic node definition based on Python type annotations. Just write annotated Python and turn your functions into nodes with a simple @ComfyNode decorator.
- **ComfyUI Type Support**: Includes common types (e.g., ImageTensor, MaskTensor) to support ComfyUI's connection semantics. Register your own custom types with `easy_nodes.register_type()`
- **Widget Support**: Special classes (StringInput, NumberInput and Choice) provide full support for ComfyUI's widget behavior when used as defaults to int, float and string inputs. 
- **Automatic List and Tuple Handling**: Simplifies input/output for functions expecting or returning collections.
- **Init-time andChecking**: Provides early alerts for common setup issues like duplicate node definitions.
- **Built-in Text and Image Previews**: Easily add previews to nodes without JavaScript using `easy_nodes.show_text()` and `easy_nodes.show_image()`.
- **Change node defaults**: Set node colors and initial dimensions via the decorator, also avoiding the need to write custom JavaScript.

### Advanced Features
- **Dynamic Node Creation**: Automatically create nodes from existing Python classes, adding widgets for every field (for basic types like string, int and float).
- **ComfyUI Node Definition Support**: Includes options for validate_input, is_output_node, and other ComfyUI-specific features.
- **Log Streaming**: Stream node logs directly to the browser for real-time debugging. Just hover the mouse over the 📜 icon to show the latest captured log from that node in a pop-up window, or click through to open in a new tab.
- **Deep Source Links**: Quick access to the source code for your nodes in IDEs or GitHub when base paths are configured in options.
- **Info Tooltips**: Auto-generated from function docstrings.
- **Custom Type Verification**: Verify tensor shapes and data types according to catch problematic behavior early.
- **LLM-based Debugging**: Optional ChatGPT-powered debugging and automatic code fixing for exceptions during node execution.

### ComfyUI Quality of Life Improvements
- **Better Stack Traces**: Enhanced exception windows with deep source links when configured (works for all nodes).
- **Preview Image Persistence**: Keep your preview images across browser sessions, so that you don't have to re-run your prompts just to see them again.
- **Automatic Module Reloading**: Immediately see code changes to EasyNodes nodes on the next run with this optional setting, saving you time that would normally be spent restarting ComfyUI.

## New Features in Action

|||
|------|-------|
|<img src="assets/threshold_example.png" alt="basic example" style="width: 100%;">New icons on node titlebars: Logs, Info, and Source.<br>Node colors set via @ComfyNode decorator.|<img src="assets/log_streaming.png" alt="Log streaming" style="width: 100%;">Live log streaming. Just hover over the 📜 icon, and click the pin to make the window persistent.|
|<img src="assets/menu_options.png" alt="New menu options" style="width: 100%;">All options.|<img src="assets/exceptions.png" alt="Better stack traces">Better stack traces. Set the stack trace prefix to get prettier dialogues with links directly to the source locations.|


## Changelog

### New in 1.2:

- Stream node logs right to your browser; when an EasyNode is run it will show a log icon on the title bar. Clicking this will open up a new tab where you can see the logs accumulated during that node's execution. Icon rendering can be disabled via settings option if you want to keep things cleaner; in this case access via right-click menu option.
- Added save_node_list function to export nodes to a json file. This can be helpful e.g. for ingestion by ComfyUI-Manager.
- Set default node width and height, and add force_input to NumberInput (thanks isaacwasserman)
- Retain preview images across browser refreshes if option is enabled (applies to all ComfyUI nodes)
- Bug fixes and cleanup.

### New in 1.1:

- Custom verifiers for types on input and output for your nodes. For example, it will automatically verify that images always have 1, 3 or 4 channels (B&W, RGB and RGBA). Set `verify_level` when calling initialize_easy_nodes to either CheckSeverityMode OFF, WARN, or FATAL (default is WARN). You can write your own verifiers. See [comfy_types.py](easy_nodes/comfy_types.py) for examples of types with verifiers.
- Expanded ComfyUI type support. See [comfy_types.py](easy_nodes/comfy_types.py) for the full list of registered types.
- Added warnings if relying on node auto-registration without explicitly asking for it (while also supporting get_node_mappings() at the same time). This is because the default for auto_register will change to False in a future release, in order to make ComfyUI-EasyNodes more easily findable by indexers like ComfyUI-Manager (which expects your nodes to be found in your `__init__.py`). Options:
  - If you wish to retain the previous behavior, you can enable auto-registration explicitly with `easy_nodes.initialize_easy_nodes(auto_register=True)`.
  - Otherwise, export your nodes the normal way as shown in the [installation](#installation) section.

### New in 1.0:

- Renamed to ComfyUI-EasyNodes from ComfyUI-Annotations to better reflect the package's goal (rather than the means)
  - Package is now `easy_nodes` rather than `comfy_annotations`
- Now on pip/PyPI! ```pip install ComfyUI-EasyNodes```
- Set node foreground and background color via Python argument, no JS required: `@ComfyNode(color="FF0000", bg_color="00FF00")`
- Add previews to nodes without JavaScript. Just drop either of these in the body of your node's function:
  - `easy_nodes.show_text("hello world")`
  - `easy_nodes.show_image(image)`
- Automatically create nodes from existing Python classes. The dynamic node will automatically add a widget for every field.
- Info tooltip on nodes auto-generated from your function's docstring
- New optional settings features:
  - Make images persist across browser refreshes via a settings option (provided they're still on the server)
  - Automatic module reloading: if you turn on the setting, immediately see the changes to code on the next run.
  - LLM-based debugging: optionally have ChatGPT take a crack at fixing your code
  - Deep links to source code if you set a base source path (e.g. to github or your IDE)
- Bug fixes

## Installation

To use this module in your ComfyUI project, follow these steps:

1. **Install the Module**: Run the following command to install the ComfyUI-EasyNodes module:

    ```bash
    pip install ComfyUI-EasyNodes
    ```
    or, if you want to have an editable version:
    ```bash
    git clone https://github.com/andrewharp/ComfyUI-EasyNodes
    pip install -e ComfyUI-EasyNodes
    ```
    Note that this is not a typical ComfyUI nodepack, so does not itself live under custom_nodes.
    
    However, after installing you can copy the example node directory into custom_nodes to test them out:
    ```bash
    git clone --depth=1 https://github.com/andrewharp/ComfyUI-EasyNodes.git /tmp/easynodes
    mv /tmp/easynodes/example $COMFYUI_DIR/custom_nodes/easynodes
    ```

3. **Integrate into Your Project**:
    In `__init__.py`:

    ```python
    import easy_nodes
    easy_nodes.initialize_easy_nodes(default_category=my_category, auto_register=False)

    # This must come after calling initialize_easy_nodes.
    import your_node_module  # noqa: E402

    NODE_CLASS_MAPPINGS, NODE_DISPLAY_NAME_MAPPINGS = easy_nodes.get_node_mappings()

    # Export so that ComfyUI can pick them up.
    __all__ = ['NODE_CLASS_MAPPINGS', 'NODE_DISPLAY_NAME_MAPPINGS']
    
    # Optional: export the node list to a file so that e.g. ComfyUI-Manager can pick it up.
    easy_nodes.save_node_list(os.path.join(os.path.dirname(__file__), "node_list.json"))
    ```

    You can also initialize with auto_register=True, in which case you won't have to do anything else after the import. However, this may be problematic for having your nodes indexed so will default to False in a future update (currently not setting it explicitly will auto-register and complain).


## Initialization options

The options passed to `easy_nodes.initialize_easy_nodes` will apply to all nodes registered until the next time `easy_nodes.initialize_easy_nodes` is called.

The settings mostly control defaults and some optional features that I find nice to have, but which may not work for everybody, so some are turned off by default.

- `default_category`: The default category for nodes. Defaults to "EasyNodes".
- `auto_register`: Whether to automatically register nodes with ComfyUI (so you don't have to export). Previously defaulted to True; now defaults to half-true (will auto-register, allow you to export, and print a warning). In a future release will default to False.
- `docstring_mode`: The mode for generating node descriptions that show up in tooltips. Defaults to AutoDescriptionMode.FULL.
- `verify_level`: Whether to verify tensors for shape and data type according to ComfyUI type (MASK, IMAGE, etc). Runs on inputs and outputs. Can be set to CheckSeverityMode.OFF, WARN, or FATAL. Defaults to WARN, as I've made some assumptions about shapes that may not be universal.
- `auto_move_tensors`: Whether to automatically move torch Tensors to the GPU before your function gets called, and then to the CPU on output. Defaults to False.


## Using the decorator

1. **Annotate Functions with @ComfyNode**: Decorate your processing functions with `@ComfyNode`. The decorator accepts the following parameters:
   - `category`: Specifies the category under which the node will be listed in ComfyUI. Default is `"ComfyNode"`.
   - `display_name`: Optionally specifies a human-readable name for the node as it will appear in ComfyUI. If not provided, a name is generated based on the function name.
   - `workflow_name`: The internal unique identifier for this node type. If not provided, a name is generated based on the function name.
   - `description`: An optional description for the node. If not provided the function's docstring, if any, will be used according to `easy_nodes.docstring_mode`.
   - `is_output_node`: Maps to ComfyUI's IS_OUTPUT_NODE.
   - `return_types`: Maps to ComfyUI's RETURN_TYPES. Use if the return type of the function itself is dynamic.
   - `return_names`: Maps to ComfyUI's RETURN_NAMES.
   - `validate_inputs`: Maps to ComfyUI's VALIDATE_INPUTS.
   - `is_changed`: Maps to ComfyUI's IS_CHANGED.
   - `always_run`: Makes the node always run by generating a random IS_CHANGED.
   - `debug`: A boolean that makes this node print out extra information during its lifecycle.
   - `color`: Changes the node's color.
   - `bg_color`: Changes the node's color. If color is set and not bg_color, bg_color will just be a slightly darker color.
   - `width`: Default width for this node type on creation.
   - `height`: Default height for this node type on creation.

    Example:
    ```python
    from easy_nodes import ComfyNode, ImageTensor, NumberInput

    @ComfyNode(category="Image Processing",
               display_name="Enhance Image",
               is_output_node=True,
               debug=True,
               color="#FF00FF")
    def enhance_image(image: ImageTensor, factor: NumberInput(0.5, 0, 1, 0.1)) -> ImageTensor:
        output_image = enhance_my_image(image, factor)
        easy_nodes.show_image(output_image)  # Will show the image on the node, so you don't need a separate PreviewImage node.
        return output_image
    ```

2. **Annotate your function inputs and outputs**: Fully annotate function parameters and return types, using `list` to wrap types as appropriate. `tuple[output1, output2]` should be used if you have multiple outputs, otherwise you can just return the naked type (in the example below, that would be `list[int]`). This information is used to generate the fields of the internal class definition `@ComfyNode` sends to ComfyUI. If you don't annotate the inputs, the input will be treated as a wildcard. If you don't annotate the output, you won't see anything at all in ComfyUI.

    Example:
    ```python
    @ComfyNode("Utilities")
    def add_value(img_list: list[ImageTensor], val: int) -> list[int]:
        return [img + val for img in img_list]
    ```

### Registering new types:

Say you want a new type of special Tensor that ComfyUI will treat differently from Images; perhaps a rotation matrix. Just create a placeholder class for it and use that in your annotations -- it's just for semantics; internally your functions will get whatever type of class they're handed (though with the verification settings turned on, you can still be assured it's a Tensor object (and you are free to create your own custom verifier for more control).

```python
class RotationMatrix(torch.Tensor):
    def __init__(self):
        raise TypeError("!") # Will never be instantiated

easy_nodes.register_type(RotationMatrix, "ROTATION_MATRIX", verifier=TensorVerifier("ROTATION_MATRIX"))

@ComfyNode()
def rotate_matrix_more(rot1: RotationMatrix, rot2: RotationMatrix) -> RotationMatrix:
    return rot1 * rot2
```

Making the class extend a torch.Tensor is not necessary, but it will give you nice type hints in IDEs.

### Creating dynamic nodes from classes

You can also automatically create nodes that will expose the fields of a class as widgets (as long as it has a default constructor). Say you have a complex options class from a third-party library you want to pass to a node.

```python
from some_library import ComplexOptions

easy_nodes.register_type(ComplexOptions)

easy_nodes.create_field_setter_node(ComplexOptions)
```

Now you should be should find a node named ComplexOptions that will have all the basic field types (str, int, float, bool) exposed as widgets.

## Automatic LLM Debugging

To enable the experimental LLM-based debugging, set your OPENAI_API_KEY prior to starting ComfyUI.

e.g.:
```bash
export OPENAI_API_KEY=sk-P#$@%J345jsd...
python main.py
```

Then open settings and turn the LLM debugging option to either "On" or "AutoFix".

Behavior:
  * "On": any exception in execution by an EasyNodes node (not regular nodes) will cause EasyNodes to collect all the relevent data and package it into a prompt for ChatGPT, which is instructed to reply with a fixed version of your function function from which a patch is created. That patch is displayed in the console and also saved to disk for evaluation.
  * "AutoFix": All of the above, and EasyNodes will also apply the patch and attempt to run the prompt again. This will repeat up to the configurable retry limit.

This feature is very experimental, and any contributions for things like improving the prompt flow and suporting other LLMs are welcome! You can find the implementation in [easy_nodes/llm_debugging.py](easy_nodes/llm_debugging.py).

## Contributing

Contributions are welcome! Please submit pull requests or open issues for any bugs, features, or improvements.
