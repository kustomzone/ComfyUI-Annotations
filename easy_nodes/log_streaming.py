import asyncio
import io
import logging
import os
import re
from typing import Dict, List, Tuple

import folder_paths
from aiohttp import web
from ansi2html import Ansi2HTMLConverter
from colorama import Fore
from server import PromptServer

import easy_nodes.config_service as config_service

routes = PromptServer.instance.routes


class CloseableBufferWrapper:
    def __init__(self, buffer):
        self._buffer: io.StringIO = buffer
        self._value: str = None
        
    def close(self):
        self._value = self._buffer.getvalue()
        self._buffer.close()
        self._buffer = None
    
    def value(self):
        if self._buffer is None:
            return self._value
        return self._buffer


# Keyed on node ID, first value of tuple is prompt_id.
_buffers: Dict[str, Tuple[str, List[CloseableBufferWrapper]]] = {}


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


async def tail_buffer(buffer, offset):
    try:
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
        
        while not buffer.closed:
            await asyncio.sleep(0.1)
            buffer.seek(0, io.SEEK_END)
            if buffer.tell() > last_position:
                buffer.seek(last_position)
                content = buffer.read()
                yield content
                last_position = buffer.tell()
    except Exception as _:
        pass
    

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
    with open("unconverted.html", "w") as f:
        f.write(text)
    
    converted = _converter.convert(text, full=False)
    # Replace HTML entities
    converted = converted.replace('&lt;', '<')
    converted = converted.replace('&gt;', '>')
    converted = converted.replace('&lt;/a&gt;', '</a>')
    
    source_prefix = config_service.get_config_value("easy_nodes.SourcePathPrefix", "")
    link_prefix = config_service.get_config_value("easy_nodes.EditorPathPrefix", "")
    
    if source_prefix:
        # Replace all instances of the source prefix with a clickable link
        def replace_with_link(match):
            full_match = match.group(0)
            full_path = match.group(1)
            line_number = match.group(2)
            return f'<a href="{link_prefix}{full_path}:{line_number}">{full_match}</a>'

        # Regex to match file paths and optional line numbers
        path_pattern = rf'File "({re.escape(source_prefix)}[\w/.-]+\.py)", line (\d+)(?:,| in).*?'
        converted = re.sub(path_pattern, replace_with_link, converted)
    
    # Write it to a file to see what's going on
    with open("converted.html", "w") as f:
        f.write(converted)
    
    return converted.encode('utf-8')


async def stream_content(response, content_generator):
    try:
        async for line in content_generator:
            html_line = convert_text(line)
            try:
                await response.write(html_line)
                await response.drain()
            except ConnectionResetError:
                break
    except asyncio.CancelledError:
        pass
    except Exception as e:
        print(f"Error in stream_content: {str(e)}")
    finally:
        return response


def send_footer(response):
    response.write(b"</pre></body></html>")
    response.force_close()
    

@routes.get("/easy_nodes/show_log")
async def show_log(request):
    offset = int(request.rel_url.query.get("offset", "-1"))
    if "node" in request.rel_url.query:
        try:
            node_id = str(request.rel_url.query["node"])
            if node_id not in _buffers:
                logging.error(f"Node {node_id} not found in buffers: {_buffers}")
                return web.json_response({"node not found": node_id,
                                        "valid nodes": [str(key) for key in _buffers.keys()]}, status=404)
            
            response = await send_header(request)
            node_class, prompt_id, buffer_list = _buffers[node_id]
            await response.write(convert_text(f"Logs for node {Fore.GREEN}{node_id}{Fore.RESET} ({Fore.GREEN}{node_class}{Fore.RESET}) in prompt {Fore.GREEN}{prompt_id}{Fore.RESET}\n\n"))
            
            invocation = 1
            last_buffer_index = 0
            while True:
                for i in range(last_buffer_index, len(buffer_list)):
                    buffer = buffer_list[i]
                    invocation_header = f"======== Node invocation {Fore.GREEN}{invocation:3d}{Fore.RESET} ========\n"
                    await response.write(convert_text(invocation_header))
                    invocation += 1
                    buffer_content = buffer.value()
                    generator = tail_string(buffer_content, offset) if isinstance(buffer_content, str) else tail_buffer(buffer_content, offset)
                    await stream_content(response, generator)
                    last_buffer_index = i + 1
                    await response.write("\n\n")
                
                # Wait for a second to check for new logs in case there's more coming.
                await asyncio.sleep(1)
                if last_buffer_index >= len(buffer_list):
                    break

            await response.write(b"=====================================\n\nEnd of node logs.</pre></body></html>")
        except Exception as _:
            pass
                
        return response

    response = await send_header(request)
    await stream_content(request, tail_file("comfyui.log", offset), response)
    send_footer(response)
    return response
    

def add_log_buffer(node_id: str, node_class: str, prompt_id: str, buffer_wrapper: CloseableBufferWrapper):
    node_id = str(node_id)
    
    if node_id in _buffers:
        node_class, existing_prompt_id, buffers = _buffers[node_id]
        if existing_prompt_id != prompt_id:
            log_list = [] 
            _buffers[node_id] = (node_class, prompt_id, log_list)
        else:
            log_list = buffers
    else:
        log_list = []
        _buffers[node_id] = (node_class, prompt_id, log_list)

    log_list.append(buffer_wrapper)

    nodes_with_logs = [key for key in _buffers.keys()]
    PromptServer.instance.send_sync("logs_updated", {"nodes_with_logs": nodes_with_logs}, None)


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
