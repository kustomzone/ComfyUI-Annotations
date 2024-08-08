import asyncio
import html
import io
import logging
import os
import re
import traceback
from typing import Dict, List, Tuple

import folder_paths
from aiohttp import web
from ansi2html import Ansi2HTMLConverter
from colorama import Fore
from server import PromptServer

import easy_nodes.config_service as config_service

routes = PromptServer.instance.routes


class CloseableBufferWrapper:
    def __init__(self, buffer: io.StringIO):
        self._buffer: io.StringIO = buffer
        self._value: str = None
        self._closed: bool = False

    def close(self):
        self._value = self._buffer.getvalue()
        self._buffer.close()
        self._buffer = None
        self._closed = True

    async def stream_buffer(self, offset=0):
        try:
            buffer = self._buffer if not self._closed else io.StringIO(self._value)
            buffer.seek(0, io.SEEK_END)
            buffer_size = buffer.tell()
            if offset == -1:
                start_position = 0
            else:
                start_position = max(0, buffer_size - offset)

            buffer.seek(start_position)
            content = buffer.read()
            yield content

            last_position = buffer.tell()

            while True:
                # TODO: fix the microscopic chance for a race condition here. 
                # close() needs to async so we can await a lock there and here.
                if self._closed:
                    # Stream the remaining content and exit
                    remaining_content = self._value[last_position:]
                    if remaining_content:
                        yield remaining_content
                    break
                
                buffer.seek(0, io.SEEK_END)
                if buffer.tell() > last_position:
                    buffer.seek(last_position)
                    content = buffer.read()
                    yield content
                    last_position = buffer.tell()
                
                await asyncio.sleep(0.1)
                        
        except Exception as _:
            logging.error(f"Error in stream_buffer: {traceback.format_exc()}")


# Keyed on node ID, first value of tuple is prompt_id.
_buffers: Dict[str, Tuple[str, List[CloseableBufferWrapper]]] = {}
_prompt_id = None
_last_node_id = None


async def tail_file(filename, offset):
    file_size = os.path.getsize(filename)
    if offset == -1:
        start_position = 0
    else:
        start_position = max(0, file_size - offset)

    with open(filename, 'r') as f:
        f.seek(start_position)
        # First, yield any existing content from the offset
        content = f.read()
        if content:
            yield content

        # Then, continue to tail the file
        f.seek(0, os.SEEK_END)
        while True:
            line = f.readline()
            if not line:
                await asyncio.sleep(0.1)
                continue
            yield line


async def tail_string(content: str, offset: int):
    if offset == -1:
        yield content
    else:
        yield content[-offset:]


def minify_html(html):
    # Remove comments
    html = re.sub(r'<!--.*?-->', '', html, flags=re.DOTALL)
    # Remove whitespace between tags
    html = re.sub(r'>\s+<', '><', html)
    # Remove leading and trailing whitespace
    html = html.strip()
    # Combine multiple spaces into one
    html = re.sub(r'\s+', ' ', html)
    return html


header = minify_html("""<!DOCTYPE html>
<html>
<head>
    <title>ComfyUI Log</title>
    <style>
        body { background-color: #1e1e1e; color: #d4d4d4; font-family: monospace; }
        pre { white-space: pre-wrap; word-wrap: break-word; }
        a { color: #5aafff; text-decoration: none; }
        a:hover { text-decoration: underline; }
    </style>
</head>
<body>
<pre>""")


async def send_header(request) -> web.StreamResponse:
    response = web.StreamResponse(
        status=200,
        reason='OK',
        headers={'Content-Type': 'text/html'},
    )
    await response.prepare(request)
    await response.write(header.encode('utf-8'))
    return response


_converter = Ansi2HTMLConverter(inline=True)


def convert_text(text: str):
    # Convert ANSI codes to HTML
    converted = _converter.convert(text, full=False, ensure_trailing_newline=False)
    editor_prefix = config_service.get_config_value("easy_nodes.EditorPathPrefix", "")
    source_prefix = config_service.get_config_value("easy_nodes.SourcePathPrefix")

    def replace_with_link(match):
        full_path = match.group(1)
        line_no = match.group(2)
        full_link = f"{editor_prefix}{full_path}:{line_no}"
        
        # Remove source path prefix if it exists
        if source_prefix and full_path.startswith(source_prefix):
            full_path = full_path[len(source_prefix):]
        
        return f'<a href="{full_link}">{full_path}:{line_no}</a>'

    # Regex pattern to match the [[LINK:filepath:lineno]] format
    log_pattern = r'\[\[LINK:([^:]+):([^:]+)\]\]'
    converted = re.sub(log_pattern, replace_with_link, converted)
    
    # Also look for anything matching source path prefix and convert to link 
    if editor_prefix:
        stack_trace_pattern = r'File "([^"]+)", line (\d+), in (\w+)'
        converted = re.sub(stack_trace_pattern, 
                           lambda m: f'{replace_with_link(m)} in <span style="color: #02C0D0;">{m.group(3)}</span>', 
                           converted)
    
    return converted.encode('utf-8')


async def stream_content(response, content_generator):
    try:
        async for line in content_generator:
            try:
                await send_text(response, line)
            except ConnectionResetError:
                break
    except asyncio.CancelledError:
        pass
    except Exception as e:
        print(f"Error in stream_content: {str(e)}")
    finally:
        return response


async def send_footer(response):
    await response.write(b"</pre></body></html>")
    response.force_close()


def send_node_update():    
    nodes_with_logs = [key for key in _buffers.keys()]
    PromptServer.instance.send_sync("logs_updated", {"nodes_with_logs": nodes_with_logs, "prompt_id": _prompt_id}, None)


@routes.post("/easy_nodes/trigger_log")
async def trigger_log(request):
    send_node_update()
    return web.Response(status=200)


async def send_text(response: web.Request, text: str):
    debug = False
    if debug:
        with open("log_streaming.log", "a") as f:
            f.write(f"{text}")

    await response.write(convert_text(text))
    await response.drain()


@routes.get("/easy_nodes/show_log")
async def show_log(request: web.Request):
    offset = int(request.rel_url.query.get("offset", "-1"))
    if "node" in request.rel_url.query:
        try:
            node_id = str(request.rel_url.query["node"])
            if node_id not in _buffers:
                logging.error(f"Node {node_id} not found in buffers: {_buffers}")
                return web.json_response({"node not found": node_id,
                                        "valid nodes": [str(key) for key in _buffers.keys()]}, status=404)

            response = await send_header(request)
            await send_text(response, "Sent header!\n")
            node_class, prompt_id, buffer_list = _buffers[node_id]
            await send_text(
                response,
                f"Logs for node {Fore.GREEN}{node_id}{Fore.RESET}"
                + f" ({Fore.GREEN}{node_class}{Fore.RESET})"
                + f" in prompt {Fore.GREEN}{prompt_id}{Fore.RESET}\n\n",
            )

            invocation = 1
            last_buffer_index = 0

            while True:
                for i in range(last_buffer_index, len(buffer_list)):
                    input_desc, buffer = buffer_list[i]
                    input_desc_str = "\n".join(input_desc) if isinstance(input_desc, list) else input_desc
                    invocation_header = f"======== Node invocation {Fore.GREEN}{invocation:3d}{Fore.RESET} ========\n"
                    await send_text(response, invocation_header)
                    await send_text(response, f"Params passed to node:\n{Fore.CYAN}{input_desc_str}{Fore.RESET}\n--\n")
                    invocation += 1
                    await stream_content(response, buffer.stream_buffer(offset))
                    last_buffer_index = i + 1

                # Wait for a second to check for new logs in case there's more coming.
                if _last_node_id != node_id:
                    logging.info(f"Node ID changed from {_last_node_id} to {node_id} {type(_last_node_id)} {type(node_id)}")
                    break
                
                # If the next node wasn't an EasyNode or this was the actual last node in the prompt, we can't be completely
                # sure if there's more logs coming. So we'll just wait for a second and check again.
                if len(buffer_list) == last_buffer_index:
                    await asyncio.sleep(0.5)
                    if len(buffer_list) == last_buffer_index:
                        break

            await send_text(response, "=====================================\n\nEnd of node logs.")
            await send_footer(response)
        except Exception as e:
            # Most exceptions seem to be related to the response object being closed (user closed the window)
            logging.debug(f"Error in show_log for node {node_id} (last node id: {_last_node_id}): {str(e)} {traceback.format_exc()}")            
            return web.Response(status=500)
        return response

    response = await send_header(request)
    await stream_content(response, tail_file("comfyui.log", offset))
    await send_footer(response)
    return response


def add_log_buffer(node_id: str, node_class: str, prompt_id: str, input_desc: str, 
                   buffer_wrapper: CloseableBufferWrapper):
    global _prompt_id
    _prompt_id = prompt_id
    
    global _last_node_id
    _last_node_id = node_id
    
    node_id = str(node_id)
    
    if node_id in _buffers:
        existing_node_class, existing_prompt_id, buffers = _buffers[node_id]
        if existing_prompt_id != prompt_id:
            log_list = [] 
            _buffers[node_id] = (node_class, prompt_id, log_list)
        else:
            log_list = buffers
    else:
        log_list = []
        _buffers[node_id] = (node_class, prompt_id, log_list)

    log_list.append((input_desc, buffer_wrapper))    
    send_node_update()


@routes.get("/easy_nodes/verify_image")
async def verify_image(request):
    if "filename" in request.rel_url.query:
        filename = request.rel_url.query["filename"]
        filename, output_dir = folder_paths.annotated_filepath(filename)

        # validation for security: prevent accessing arbitrary path
        if filename[0] == '/' or '..' in filename:
            return web.Response(status=400)

        if output_dir is None:
            type = request.rel_url.query.get("type", "output")
            output_dir = folder_paths.get_directory_by_type(type)

        if output_dir is None:
            return web.Response(status=400)

        if "subfolder" in request.rel_url.query:
            full_output_dir = os.path.join(output_dir, request.rel_url.query["subfolder"])
            if os.path.commonpath((os.path.abspath(full_output_dir), output_dir)) != output_dir:
                return web.Response(status=403)
            output_dir = full_output_dir

        file = os.path.join(output_dir, filename)
        return web.json_response({"exists": os.path.isfile(file)})

    return web.Response(status=400)
