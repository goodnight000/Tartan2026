from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable


ToolHandler = Callable[[Any, dict[str, Any]], dict[str, Any]]


@dataclass
class ToolDefinition:
    name: str
    handler: ToolHandler
    transactional: bool = False


class ToolRegistry:
    def __init__(self) -> None:
        self._tools: dict[str, ToolDefinition] = {}
        self._aliases: dict[str, str] = {}

    def register(self, tool: ToolDefinition) -> None:
        self._tools[tool.name] = tool

    def add_alias(self, alias: str, target: str) -> None:
        self._aliases[alias] = target

    def resolve(self, name: str) -> ToolDefinition:
        canonical = self._aliases.get(name, name)
        tool = self._tools.get(canonical)
        if not tool:
            raise KeyError(f"Tool not found: {name}")
        return tool

    def list_names(self) -> list[str]:
        return sorted(self._tools.keys())

