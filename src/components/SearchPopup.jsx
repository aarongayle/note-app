import { useState, useEffect, useRef, useMemo } from "react";
import { Search as SearchIcon, X, ChevronUp, ChevronDown } from "lucide-react";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api.js";
import useNotesStore from "../stores/useNotesStore.js";

export default function SearchPopup({ noteId, onClose }) {
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [searchHandwriting, setSearchHandwriting] = useState(true);
  const [searchText, setSearchText] = useState(true);
  const [searchBackground, setSearchBackground] = useState(true);

  const [currentIndex, setCurrentIndex] = useState(-1);
  const [prevResultsLength, setPrevResultsLength] = useState(0);

  const inputRef = useRef(null);
  const noteZoom = useNotesStore((s) => s.items[noteId]?.zoom ?? 1);

  // Debounce query
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(query);
    }, 300);
    return () => clearTimeout(timer);
  }, [query]);

  // Fetch handwriting results
  const handwritingResults = useQuery(
    api.search.searchTranscriptions,
    debouncedQuery && searchHandwriting && noteId && noteId.length > 10
      ? { clientId: noteId, searchQuery: debouncedQuery }
      : "skip"
  );

  console.log("Handwriting Query Args:", { clientId: noteId, searchQuery: debouncedQuery });

  const note = useNotesStore((state) => state.items[noteId]);

  const results = useMemo(() => {
    if (!debouncedQuery) {
      return [];
    }

    console.log("Searching for:", debouncedQuery);

    const newResults = [];
    const lowerQuery = debouncedQuery.toLowerCase();

    // 1. Handwriting
    if (searchHandwriting && handwritingResults) {
      console.log("Handwriting results:", handwritingResults);
      for (const res of handwritingResults) {
        newResults.push({
          type: "handwriting",
          text: res.text,
          y: res.startY,
          id: res._id,
        });
      }
    }

    // 2. TextBoxes
    if (searchText && note?.textBoxes) {
      console.log("Checking text boxes:", note.textBoxes);
      for (const box of note.textBoxes) {
        if (box.content.toLowerCase().includes(lowerQuery)) {
          // Try to find the actual element to get its current position
          const element = document.querySelector(`[data-text-box-id="${box.id}"]`);
          let y = box.y;
          if (element) {
            const container = document.querySelector(`[data-note-scroll="${noteId}"]`);
            if (container) {
              const rect = element.getBoundingClientRect();
              const containerRect = container.getBoundingClientRect();
              y = (rect.top - containerRect.top + container.scrollTop) / noteZoom;
            }
          }
          
          newResults.push({
            type: "text",
            text: box.content,
            y: y,
            id: box.id,
          });
        }
      }
    }

    // 3. Background (PDF/EPUB)
    if (searchBackground) {
      const container = document.querySelector(`[data-note-scroll="${noteId}"]`);
      if (container) {
        // Use a more robust way to find text in PDF/EPUB
        // PDF.js renders text in 'textLayer' divs
        // EPUB renders in 'epub-container'
        const textLayers = container.querySelectorAll('.textLayer, .epub-container, .rendered-epub-content');
        let bgIndex = 0;
        let bgMatches = 0;

        const processNode = (node) => {
          if (node.nodeType === Node.TEXT_NODE) {
            const text = node.nodeValue.toLowerCase();
            if (text.includes(lowerQuery)) {
              const parent = node.parentElement;
              const rect = parent.getBoundingClientRect();
              const containerRect = container.getBoundingClientRect();
              
              const physicalY = (rect.top - containerRect.top) + container.scrollTop;
              const logicalY = physicalY / noteZoom;
              
              newResults.push({
                type: "background",
                text: node.nodeValue.trim(),
                y: logicalY,
                id: `bg-${bgIndex++}`,
              });
              bgMatches++;
            }
          } else {
            for (let i = 0; i < node.childNodes.length; i++) {
              processNode(node.childNodes[i]);
            }
          }
        };

        if (textLayers.length > 0) {
          textLayers.forEach(layer => processNode(layer));
        } else {
          // Fallback to searching the whole container if specific layers aren't found
          const walker = document.createTreeWalker(
            container,
            NodeFilter.SHOW_TEXT,
            null,
            false
          );
          let node;
          while ((node = walker.nextNode())) {
            const parent = node.parentElement;
            if (!parent) continue;
            if (node.nodeValue.toLowerCase().includes(lowerQuery)) {
              const rect = parent.getBoundingClientRect();
              const containerRect = container.getBoundingClientRect();
              const physicalY = (rect.top - containerRect.top) + container.scrollTop;
              const logicalY = physicalY / noteZoom;
              newResults.push({
                type: "background",
                text: node.nodeValue.trim(),
                y: logicalY,
                id: `bg-${bgIndex++}`,
              });
              bgMatches++;
            }
          }
        }
        console.log("Background matches:", bgMatches);
      }
    }

    newResults.sort((a, b) => a.y - b.y);
    console.log("Total results:", newResults);
    return newResults;
  }, [debouncedQuery, searchHandwriting, searchText, searchBackground, handwritingResults, note, noteId, noteZoom]);

  // Update index when results change without triggering cascading renders
  if (results.length !== prevResultsLength) {
    setPrevResultsLength(results.length);
    setCurrentIndex(results.length > 0 ? 0 : -1);
  }

  // Handle navigation
  useEffect(() => {
    if (currentIndex >= 0 && currentIndex < results.length) {
      const result = results[currentIndex];
      const container = document.querySelector(`[data-note-scroll="${noteId}"]`);
      if (container) {
        // Scroll to the result, putting it roughly in the middle of the screen
        const targetPhysicalY = result.y * noteZoom;
        const offset = container.clientHeight / 3;
        container.scrollTo({ top: Math.max(0, targetPhysicalY - offset), behavior: "smooth" });
      }
    }
  }, [currentIndex, results, noteId, noteZoom]);

  const handleNext = () => {
    if (results.length > 0) {
      setCurrentIndex((prev) => (prev + 1) % results.length);
    }
  };

  const handlePrev = () => {
    if (results.length > 0) {
      setCurrentIndex((prev) => (prev - 1 + results.length) % results.length);
    }
  };

  // Focus input on mount
  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.focus();
    }
  }, []);

  return (
    <div className="fixed top-16 right-4 z-50 bg-surface shadow-lg rounded-lg border border-border p-3 w-[calc(100vw-2rem)] max-w-sm flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <SearchIcon className="w-4 h-4 text-text-secondary" />
        <input
          ref={inputRef}
          type="text"
          placeholder="Search document..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              if (e.shiftKey) handlePrev();
              else handleNext();
            } else if (e.key === "Escape") {
              onClose();
            }
          }}
          className="flex-1 bg-transparent border-none outline-none text-sm text-text-primary placeholder:text-text-secondary"
        />
        <span className="text-xs text-text-secondary font-mono">
          {results.length > 0 ? `${currentIndex + 1}/${results.length}` : "0/0"}
        </span>
        <div className="flex items-center gap-1 border-l border-border pl-2">
          <button
            onClick={handlePrev}
            disabled={results.length === 0}
            className="p-1 hover:bg-surface-lighter rounded text-text-secondary disabled:opacity-50"
          >
            <ChevronUp className="w-4 h-4" />
          </button>
          <button
            onClick={handleNext}
            disabled={results.length === 0}
            className="p-1 hover:bg-surface-lighter rounded text-text-secondary disabled:opacity-50"
          >
            <ChevronDown className="w-4 h-4" />
          </button>
          <button
            onClick={onClose}
            className="p-1 hover:bg-surface-lighter rounded text-text-secondary ml-1"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-2 text-sm text-text-secondary">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={searchHandwriting}
            onChange={(e) => setSearchHandwriting(e.target.checked)}
            className="rounded border-border text-accent focus:ring-accent"
          />
          Handwriting
        </label>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={searchText}
            onChange={(e) => setSearchText(e.target.checked)}
            className="rounded border-border text-accent focus:ring-accent"
          />
          Text
        </label>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={searchBackground}
            onChange={(e) => setSearchBackground(e.target.checked)}
            className="rounded border-border text-accent focus:ring-accent"
          />
          Background (PDF/EPUB)
        </label>
      </div>
    </div>
  );
}
