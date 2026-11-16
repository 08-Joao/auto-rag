"use client";

import { Check, Menu, Share2, SlidersHorizontal } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { VisualReranker } from "@/services/chats";

export function ChatHeader({
  hasChat,
  isBusy,
  onOpenSidebar,
  onRerankerChange,
  onShare,
  reranker,
  shareLabel,
  title,
}: {
  hasChat: boolean;
  isBusy: boolean;
  onOpenSidebar: () => void;
  onRerankerChange: (value: VisualReranker) => void;
  onShare: () => void;
  reranker: VisualReranker;
  shareLabel: string;
  title: string;
}) {
  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b bg-background/95 px-3 backdrop-blur supports-[backdrop-filter]:bg-background/80 sm:px-4">
      <div className="flex min-w-0 items-center gap-2">
        <Button
          aria-label="Abrir conversas"
          className="lg:hidden"
          onClick={onOpenSidebar}
          size="icon"
          variant="ghost"
        >
          <Menu />
        </Button>
        <h1 className="truncate text-sm font-medium sm:text-base">{title}</h1>
      </div>
      {hasChat && (
        <div className="flex shrink-0 items-center gap-1">
          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <Button
                    aria-label="Configurar seleção de imagens"
                    size="icon"
                    variant="ghost"
                  >
                    <SlidersHorizontal />
                  </Button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent>Seleção de imagens</TooltipContent>
            </Tooltip>
            <DropdownMenuContent align="end" className="w-64">
              <DropdownMenuLabel>Reranqueamento multimodal</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuRadioGroup
                onValueChange={(value) =>
                  onRerankerChange(value as VisualReranker)
                }
                value={reranker}
              >
                <DropdownMenuRadioItem disabled={isBusy} value="clip">
                  <span className="flex-1">
                    <span className="block">CLIP</span>
                    <span className="block text-xs text-muted-foreground">
                      Rápido e local
                    </span>
                  </span>
                  {reranker === "clip" && <Check className="size-4" />}
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem disabled={isBusy} value="qwen">
                  <span className="flex-1">
                    <span className="block">Qwen 2.5 VL</span>
                    <span className="block text-xs text-muted-foreground">
                      Análise visual detalhada
                    </span>
                  </span>
                  {reranker === "qwen" && <Check className="size-4" />}
                </DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                aria-label="Copiar link da conversa"
                onClick={onShare}
                size="icon"
                variant="ghost"
              >
                <Share2 />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{shareLabel}</TooltipContent>
          </Tooltip>
        </div>
      )}
    </header>
  );
}
