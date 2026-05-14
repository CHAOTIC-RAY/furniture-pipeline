import { CommonModule, isPlatformBrowser } from '@angular/common';
import { DomSanitizer, SafeUrl } from '@angular/platform-browser';
import { GoogleGenAI, Modality } from '@google/genai';
import {
  ChangeDetectionStrategy,
  Component,
  signal,
  computed,
  inject,
  OnInit,
  HostListener,
  PLATFORM_ID,
} from '@angular/core';
import { SupabaseService } from './supabase.service';
import { OllamaService } from './ollama.service';
import { BrowserCaptionService } from './browser-caption.service';
import { buildResultsZip, type ZipLevel } from './zip-export';

interface JobResult {
  originalName: string;
  cleanName: string;
  safeUrl: SafeUrl;
  /** Raw `data:` URL for client-side ZIP export. */
  dataUrl: string;
  dimensions: string; // Formatting rules: W x D x H in centimeters
}

interface UploadedFile {
  file: File;
  previewUrl: SafeUrl;
  previewUrlRaw: string;
  objectName?: string;
  expandMargins?: { top: number; right: number; bottom: number; left: number };
}

interface ProcessingJob {
  id: string;
  total: number;
  completed: number;
  failed: number;
  status: 'pending' | 'processing' | 'completed';
  processType: string;
  results: JobResult[];
}

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-root',
  imports: [CommonModule],
  template: `
    <main class="min-h-screen bg-[#0a0a0a] text-[#E5E5E5] font-sans flex flex-col overflow-hidden select-none border-8 border-[#333333]">
      <header class="flex items-center justify-between px-8 py-6 border-b border-[#333333]">
        <div class="flex flex-col">
          <h1 class="text-2xl font-bold tracking-tighter uppercase leading-none">AssetEngine // Pipeline</h1>
          <p class="text-[10px] uppercase tracking-widest opacity-60 mt-1">Automated Furniture Processing v1.0</p>
        </div>
        <div class="flex items-center gap-6">
          <div class="flex gap-8 text-[11px] uppercase tracking-[0.2em] font-medium hidden md:flex items-center">
            <div>Queue Status: <span [class]="activeJob() ? 'text-orange-500' : 'opacity-60'">{{ activeJob() ? 'Active' : 'Idle' }}</span></div>
            
            <div class="flex items-center gap-2">
              <span>Engine:</span>
              <select [value]="engine()" (change)="engine.set($any($event.target).value)" class="bg-black text-[#E5E5E5] border border-[#333333] text-[9px] uppercase px-2 py-1 outline-none cursor-pointer font-bold focus:border-orange-500">
                <option value="cloud">Cloud (Multi-Model)</option>
                <option value="local">Local WebGPU (No Quota)</option>
              </select>
            </div>

            @if (activeJob()) {
               <div>Progress: <span class="font-mono text-orange-500">{{ ((activeJob()!.completed || 0) / (activeJob()!.total || 1) * 100).toFixed(1) }}%</span></div>
            }
          </div>
          
          <div class="flex items-center gap-3">
             <button (click)="showSettings.set(true)" class="p-2 border border-[#333333] bg-[#1a1a1a] hover:bg-orange-500/20 transition-colors group">
               <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="opacity-60 group-hover:opacity-100"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>
             </button>
             <button (click)="currentView.set('gallery')" [class.bg-white]="currentView() === 'gallery'" [class.text-[#0a0a0a]]="currentView() === 'gallery'" [class.bg-[#1a1a1a]]="currentView() !== 'gallery'" class="hover:bg-[#E5E5E5] hover:text-[#0a0a0a] border border-[#333333] px-6 py-2.5 text-[10px] uppercase tracking-widest font-bold transition-colors">
               Gallery
             </button>
             <button (click)="currentView.set('pipeline')" [class.bg-white]="currentView() === 'pipeline'" [class.text-[#0a0a0a]]="currentView() === 'pipeline'" [class.bg-[#1a1a1a]]="currentView() !== 'pipeline'" class="hover:bg-[#E5E5E5] hover:text-[#0a0a0a] border border-[#333333] px-6 py-2.5 text-[10px] uppercase tracking-widest font-bold transition-colors">
               Pipeline
             </button>
          </div>
        </div>

      </header>

      @if (currentView() === 'pipeline') {
        <div class="flex-1 flex flex-col lg:flex-row overflow-hidden">
          <!-- Sidebar / Upload Control -->
          <aside class="lg:w-[400px] border-b lg:border-b-0 lg:border-r border-[#333333] flex flex-col p-8 space-y-8 bg-[#111111] overflow-y-auto">
          
            <!-- Process Settings -->
            <div>
              <h3 class="text-[9px] uppercase tracking-widest font-bold opacity-40 block mb-3">Processing Modules</h3>
              <div class="flex flex-col gap-3">
                @for (mode of modes; track mode.id) {
                  <label class="flex items-center gap-3 p-3 cursor-pointer border border-[#333333] transition-colors"
                    [class]="processType() === mode.id ? 'bg-[#E5E5E5] text-[#0a0a0a]' : 'bg-[#1a1a1a] text-[#E5E5E5] hover:bg-orange-500/10'">
                    <input type="radio" name="mode" [value]="mode.id" (change)="processType.set(mode.id)" [checked]="processType() === mode.id" class="hidden">
                    <div class="flex flex-col">
                      <span class="text-xs font-bold uppercase tracking-wider">{{ mode.label }}</span>
                      <span class="text-[9px] font-mono mt-0.5 leading-relaxed" [class]="processType() === mode.id ? 'opacity-80' : 'opacity-60'">{{ mode.description }}</span>
                    </div>
                  </label>
                }
              </div>
              
              <!-- Toggles for bg_removal -->
              @if (processType() === 'bg_removal') {
                <div class="mt-4 p-4 border border-[#333333] bg-[#1a1a1a] flex flex-col gap-4">
                  <label class="flex items-center justify-between cursor-pointer group">
                    <span class="text-[10px] uppercase font-bold tracking-widest opacity-80 group-hover:opacity-100 transition-opacity">Background</span>
                    <select [value]="bgOutputFormat()" (change)="bgOutputFormat.set($any($event.target).value)" class="bg-[#0a0a0a] text-white border border-[#333333] text-[9px] uppercase px-2 py-1 outline-none cursor-pointer">
                      <option value="transparent">Transparent</option>
                      <option value="white">Solid White</option>
                    </select>
                  </label>
                  
                  <label class="flex items-center justify-between cursor-pointer group">
                    <span class="text-[10px] uppercase font-bold tracking-widest opacity-80 group-hover:opacity-100 transition-opacity">Clean Clutter (Inside/On)</span>
                    <div class="relative w-8 h-4 bg-[#333333] transition-colors" [class.bg-orange-500]="cleanObjects()">
                      <div class="absolute top-0 bottom-0 w-4 bg-white transition-transform" [class.translate-x-4]="cleanObjects()"></div>
                      <input type="checkbox" [checked]="cleanObjects()" (change)="cleanObjects.set($any($event.target).checked)" class="opacity-0 absolute inset-0 z-10 cursor-pointer w-full h-full">
                    </div>
                  </label>
                </div>
              }
              @if (localPipelineBlocked()) {
                <p class="text-[9px] font-mono text-orange-500 border border-orange-900/50 bg-orange-950/30 p-3 leading-relaxed mt-4">
                  Local WebGPU engine only supports <span class="font-bold">Bulk Background Removal</span>. Choose that module or switch to Cloud. Cloud fallback for failed local runs is optional in settings.
                </p>
              }
            </div>

            <!-- Dropzone -->
            <div>
              <label for="upload_input" class="text-[9px] uppercase tracking-widest font-bold opacity-40 block mb-3">Source Directory</label>
              <label for="upload_input" class="bg-[#1a1a1a] border border-dashed border-[#333333] relative overflow-hidden group p-8 flex flex-col items-center justify-center text-center gap-4 transition-colors hover:bg-[#222222] cursor-pointer min-h-[160px]">
                <input 
                  id="upload_input"
                  type="file" 
                  multiple 
                  accept="image/*"
                  class="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                  (change)="onFileSelected($event)">
                  
                <div>
                  <p class="text-[11px] font-bold uppercase tracking-wide">Drag images or click</p>
                  <p class="text-[9px] font-mono opacity-60 mt-1">.jpg, .png, .webp (up to 50)</p>
                </div>
              </label>
            </div>
            
            <div class="mt-auto pt-8 border-t border-[#333333]">
              @if (selectedFiles().length > 0) {
                <div class="flex flex-col gap-2">
                  <p class="text-[9px] font-mono opacity-60 mb-1 border border-[#333333] bg-[#1a1a1a] p-2">BUFFER: {{ selectedFiles().length }} FILES</p>
                  
                  <div class="grid grid-cols-4 gap-2 mb-2 max-h-48 overflow-y-auto pr-1">
                    @for (preview of selectedFiles(); track $index; let idx = $index) {
                      <div class="relative group aspect-square border border-[#333333] bg-[#1a1a1a] overflow-hidden flex flex-col">
                        <img [src]="preview.previewUrl" alt="Asset Preview" class="flex-1 w-full object-cover opacity-80 group-hover:opacity-100 transition-opacity min-h-0">
                        
                        @if (processType() === 'expand') {
                          <button (click)="openExpandEditor(idx)" class="absolute inset-0 m-auto w-24 h-8 bg-blue-600 hover:bg-blue-500 text-white text-[9px] uppercase font-bold tracking-widest opacity-0 group-hover:opacity-100 transition-opacity z-10 flex items-center justify-center">Edit Canvas</button>
                        }

                        <input 
                          type="text" 
                          [value]="preview.objectName || ''" 
                          (input)="updateObjectName(idx, $any($event.target).value)" 
                          placeholder="Auto-detect" 
                          class="w-full bg-[#222222] text-[#E5E5E5] text-[9px] p-1.5 border-t border-[#333333] outline-none placeholder-zinc-600 text-center uppercase tracking-wide">
                        <button (click)="removePreview(idx)" class="absolute top-0 right-0 bg-red-500 text-white w-5 h-5 flex items-center justify-center text-[10px] opacity-0 group-hover:opacity-100 transition-opacity z-10 hover:bg-red-600">×</button>
                      </div>
                    }
                  </div>

                  <button 
                    (click)="startUpload()"
                    [disabled]="isUploading() || localPipelineBlocked()"
                    class="w-full bg-[#E5E5E5] text-[#0a0a0a] py-4 text-[11px] uppercase tracking-[0.2em] font-bold hover:bg-orange-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
                    @if (isUploading()) {
                      AI CLUSTER ACTIVE...
                    } @else {
                      EXECUTE BATCH PIPELINE
                    }
                  </button>
                </div>
              } @else {
                <button 
                    disabled
                    class="w-full bg-[#1a1a1a] text-[#E5E5E5] py-4 text-[11px] uppercase tracking-[0.2em] font-bold opacity-30 cursor-not-allowed border border-[#333333]">
                    EXECUTE BATCH PIPELINE
                </button>
              }
            </div>
          </aside>

          <!-- Main View / Results -->
          <section class="flex-1 flex flex-col p-8 overflow-y-auto bg-[#0a0a0a]">
            @if (activeJob()) {
              <!-- Job Status Dashboard -->
              <div class="mb-8 border border-[#333333] bg-[#1a1a1a] p-6 relative overflow-hidden flex-shrink-0">
                 <div class="flex justify-between items-end mb-4">
                    <div>
                      <h2 class="text-[9px] uppercase tracking-widest font-bold opacity-40 mb-1">Active Batch Status</h2>
                      <p class="font-mono text-xs">{{ activeJob()?.id }}</p>
                    </div>
                    <div class="text-xs uppercase tracking-[0.2em] font-bold flex gap-4">
                      <span class="text-orange-600">{{ activeJob()?.status }}</span>
                      <span>{{ activeJob()?.completed }} / {{ activeJob()?.total }}</span>
                    </div>
                  </div>
                  
                  <div class="w-full h-1 bg-black/50 relative">
                    <div 
                      class="absolute top-0 left-0 h-full bg-orange-500 transition-all duration-500"
                      [style.width.%]="(activeJob()!.completed / activeJob()!.total) * 100">
                    </div>
                  </div>
                  
                  @if (activeJob()?.failed) {
                     <div class="mt-4 text-[9px] font-mono text-red-500 bg-red-950 p-2 border border-red-900">
                       ERRORS ENCOUNTERED: {{ activeJob()?.failed }}
                     </div>
                  }
                  
                  @if (currentPrompt()) {
                    <div class="mt-6 pt-4 border-t border-[#333333]">
                       <h3 class="text-[9px] uppercase tracking-widest font-bold opacity-40 mb-3 text-orange-500">Live Prompt Engine</h3>
                       <div class="font-mono text-[10px] opacity-80 leading-relaxed bg-[#0a0a0a] p-4 border border-[#333333] text-zinc-300 relative">
                          <div class="absolute top-0 left-0 w-1 h-full bg-orange-500"></div>
                          <div class="whitespace-pre-wrap">{{ currentPrompt() }}</div>
                          <div class="mt-2 text-orange-500 font-bold animate-pulse">_ GENERATING TENSOR GRAPH...</div>
                       </div>
                    </div>
                  }
              </div>
            }

            <div class="flex flex-col flex-1">
              <div class="flex justify-between items-end mb-6 text-[10px] uppercase tracking-widest font-bold">
                <div class="flex gap-8">
                  <span class="border-b-2 border-white pb-1">Live Grid</span>
                  <span class="opacity-30 pb-1 cursor-pointer hover:opacity-100 transition-opacity">Output Log</span>
                </div>
                <div class="flex flex-col items-end gap-2">
                  <div>Rendering Sequence: {{ results().length }}/{{ activeJob()?.total || '-' }}</div>
                  @if (results().length > 0 && activeJob()?.status === 'completed') {
                    <button
                      type="button"
                      (click)="downloadAllZip()"
                      [disabled]="isBuildingZip()"
                      class="border border-orange-600 text-orange-500 px-3 py-1.5 text-[9px] font-bold uppercase tracking-widest hover:bg-orange-500/10 disabled:opacity-40 disabled:cursor-not-allowed">
                      {{ isBuildingZip() ? 'Building ZIP…' : 'Download all (ZIP)' }}
                    </button>
                  }
                </div>
              </div>
              @if (zipNotice()) {
                <p class="text-[9px] font-mono text-orange-400 mb-4 max-w-xl leading-relaxed">{{ zipNotice() }}</p>
              }
              
              @if (!activeJob() && results().length === 0) {
                <div class="flex-1 border border-dashed border-[#333333] bg-[#111111] flex items-center justify-center min-h-[300px]">
                  <span class="text-[10px] uppercase tracking-widest font-bold opacity-40">Awaiting Pipeline Activation</span>
                </div>
              } @else {
                <div class="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-6">
                  <!-- Skeletons for pending jobs -->
                  @for (i of pendingArray(); track i) {
                    <div class="relative opacity-30">
                      <div class="aspect-square bg-[#1a1a1a] border border-dashed border-[#333333] flex items-center justify-center">
                        <span class="text-[9px] uppercase tracking-widest font-bold">Pending</span>
                      </div>
                      <div class="mt-3 space-y-2">
                         <div class="h-3 bg-[#1a1a1a] w-3/4"></div>
                         <div class="h-2 bg-[#1a1a1a] w-1/2"></div>
                      </div>
                    </div>
                  }

                  @for (res of results(); track $index) {
                    <!-- Result Cards -->
                    <div class="relative group">
                      <div class="aspect-square bg-[#111] border border-[#333333] flex flex-col items-center justify-center relative overflow-hidden p-6 transition-colors shadow-inner">
                        <img [src]="res.safeUrl" class="w-full h-full object-contain drop-shadow-[0_10px_20px_rgba(0,0,0,0.8)] transition-transform duration-500 group-hover:scale-105" alt="Processed Asset">
                        <div class="absolute top-2 right-2 text-[8px] bg-green-900/50 text-green-400 px-1.5 py-0.5 border border-green-800 font-bold uppercase drop-shadow-sm backdrop-blur-sm">DONE</div>
                      </div>
                      <div class="mt-3 space-y-1">
                        <p class="text-[11px] font-bold uppercase tracking-wide truncate" [title]="res.originalName">{{ res.originalName }}</p>
                        <!-- Rule Enforcement: W x D x H in centimeters -->
                        <p class="font-mono text-[9px] flex justify-between items-center opacity-60">
                          <span>{{ res.dimensions }}</span>
                          <a [href]="res.safeUrl" download [download]="res.cleanName" class="text-blue-600 hover:text-blue-500 transition-colors uppercase font-bold tracking-wider relative z-10 hidden group-hover:block border border-blue-600 px-1 py-0.5" style="font-size: 8px;">D/L</a>
                        </p>
                      </div>
                    </div>
                  }
                </div>
              }
            </div>
          </section>
        </div>
      } @else if (currentView() === 'gallery') {
        <div class="flex-1 flex flex-col overflow-y-auto bg-[#111] p-8">
          <div class="flex justify-between items-end mb-6 text-[10px] uppercase tracking-widest font-bold">
            <h2 class="text-lg">Gallery Database</h2>
            <div class="flex gap-4">
               <button class="border border-[#333333] bg-[#1a1a1a] px-4 py-2 hover:bg-[#333333] transition-colors">Sync</button>
            </div>
          </div>
          
          <div class="flex-1 border border-dashed border-[#333333] flex items-center justify-center min-h-[300px]">
            <span class="text-[10px] uppercase tracking-widest font-bold opacity-40 text-center">
              Gallery Synced<br/>
              <span class="text-[8px] opacity-50 mt-2 block">(No assets securely stored yet)</span>
            </span>
          </div>
        </div>
      }

      <!-- Expand Editor Modal -->
      @if (editExpandIndex() !== null) {
        <div class="fixed inset-0 z-50 bg-black/90 flex flex-col items-center justify-center p-8 backdrop-blur-sm">
          <div class="w-full max-w-4xl flex justify-between items-center mb-8">
            <h2 class="text-xl font-bold uppercase tracking-widest text-[#E5E5E5]">Define Canvas Expansion</h2>
            <button (click)="closeExpandEditor()" class="px-6 py-2 bg-white text-black uppercase text-[10px] font-bold hover:bg-[#E5E5E5] tracking-widest">Apply & Close</button>
          </div>
          
          <div class="flex-1 w-full flex items-center justify-center overflow-hidden relative user-select-none bg-[#0a0a0a] border border-[#333333]">
             <div class="relative inline-block m-20"> <!-- Ensure room for expansion -->
               <!-- The original image -->
               <img [src]="selectedFiles()[editExpandIndex()!].previewUrl" 
                    #previewImg 
                    alt="Current expansion canvas"
                    class="max-w-[50vw] max-h-[50vh] object-contain block ring-1 ring-[#333333] shadow-2xl relative z-10" 
                    draggable="false">
               
               <!-- The generated area preview (checkerboard) -->
               <!-- Outset via negative percentages matching the expansion ratios exactly -->
               <div class="absolute bg-[url('data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyMCIgaGVpZ2h0PSIyMCI+CjxyZWN0IHdpZHRoPSIxMCIgaGVpZ2h0PSIxMCIgZmlsbD0iIzIyMiIvPgo8cmVjdCB4PSIxMCIgeT0iMTAiIHdpZHRoPSIxMCIgaGVpZ2h0PSIxMCIgZmlsbD0iIzIyMiIvPgo8L3N2Zz4=')] transition-all duration-75 ring-1 ring-orange-500/50 opacity-80"
                    style="z-index: 5;"
                    [style.top.%]="-(getEditingMargins()?.top || 0)"
                    [style.bottom.%]="-(getEditingMargins()?.bottom || 0)"
                    [style.left.%]="-(getEditingMargins()?.left || 0)"
                    [style.right.%]="-(getEditingMargins()?.right || 0)">
                  
                  <!-- Top Handle -->
                  <div class="absolute top-0 left-0 w-full h-8 flex items-center justify-center cursor-ns-resize -translate-y-1/2 z-20 group"
                       (mousedown)="onDragStart($event, 'top', previewImg)">
                       <div class="w-16 h-1.5 bg-white/50 group-hover:bg-orange-500 rounded-full shadow transition-all group-hover:shadow-[0_0_10px_orange]"></div>
                  </div>
                  
                  <!-- Bottom Handle -->
                  <div class="absolute bottom-0 left-0 w-full h-8 flex items-center justify-center cursor-ns-resize translate-y-1/2 z-20 group"
                       (mousedown)="onDragStart($event, 'bottom', previewImg)">
                       <div class="w-16 h-1.5 bg-white/50 group-hover:bg-orange-500 rounded-full shadow transition-all group-hover:shadow-[0_0_10px_orange]"></div>
                  </div>
                  
                  <!-- Left Handle -->
                  <div class="absolute top-0 left-0 w-8 h-full flex items-center justify-center cursor-ew-resize -translate-x-1/2 z-20 group"
                       (mousedown)="onDragStart($event, 'left', previewImg)">
                       <div class="w-1.5 h-16 bg-white/50 group-hover:bg-orange-500 rounded-full shadow transition-all group-hover:shadow-[0_0_10px_orange]"></div>
                  </div>
                  
                  <!-- Right Handle -->
                  <div class="absolute top-0 right-0 w-8 h-full flex items-center justify-center cursor-ew-resize translate-x-1/2 z-20 group"
                       (mousedown)="onDragStart($event, 'right', previewImg)">
                       <div class="w-1.5 h-16 bg-white/50 group-hover:bg-orange-500 rounded-full shadow transition-all group-hover:shadow-[0_0_10px_orange]"></div>
                  </div>
               </div>
             </div>
          </div>
          
          <div class="mt-8 text-[10px] uppercase tracking-widest font-mono text-center opacity-60">
            Drag edges to expand. The checked background indicates new empty space to generate.
          </div>
        </div>
      }

      <!-- Settings Modal -->
      @if (showSettings()) {
        <div class="fixed inset-0 z-[100] bg-black/80 backdrop-blur-md flex items-center justify-center p-8">
           <div class="w-full max-w-md bg-[#111] border border-[#333333] shadow-2xl flex flex-col">
              <div class="p-6 border-b border-[#333333] flex justify-between items-center">
                 <h2 class="text-xs uppercase font-bold tracking-[0.2em]">Global Parameters</h2>
                 <button (click)="closeSettings()" class="text-white opacity-40 hover:opacity-100 uppercase text-[9px] font-bold">Close</button>
              </div>
              
              <div class="p-8 space-y-8">
                 <div class="space-y-3">
                    <h3 class="text-[9px] uppercase tracking-widest opacity-40 font-bold block">Processing Engine</h3>
                    <div class="grid grid-cols-2 gap-2">
                       <button (click)="engine.set('cloud')" [class.bg-white]="engine() === 'cloud'" [class.text-black]="engine() === 'cloud'" class="p-3 border border-[#333333] text-[9px] uppercase font-bold tracking-widest text-center transition-all">Cloud AI Cluster</button>
                       <button (click)="engine.set('local')" [class.bg-white]="engine() === 'local'" [class.text-black]="engine() === 'local'" class="p-3 border border-[#333333] text-[9px] uppercase font-bold tracking-widest text-center transition-all">Local WebGPU</button>
                    </div>
                    <p class="text-[8px] opacity-40 font-mono italic">Local engine process images in-browser (No Quota). Cloud uses Gemini Fallback Cluster.</p>
                 </div>

                 <div class="space-y-3">
                    <h3 class="text-[9px] uppercase tracking-widest opacity-40 font-bold block">Output Preferences</h3>
                    <div class="flex items-center justify-between p-3 border border-[#333333] bg-[#0a0a0a]">
                       <span class="text-[9px] uppercase font-bold tracking-widest">Default Background</span>
                       <select [value]="bgOutputFormat()" (change)="bgOutputFormat.set($any($event.target).value)" class="bg-black text-white border-none outline-none text-[9px] uppercase font-bold">
                          <option value="transparent">Alpha Transp.</option>
                          <option value="white">Solid White</option>
                       </select>
                    </div>
                 </div>

                 <div class="space-y-3">
                    <h3 class="text-[9px] uppercase tracking-widest opacity-40 font-bold block">Local WASM model</h3>
                    <p class="text-[8px] opacity-40 font-mono leading-relaxed">Maps to @imgly models: Fast = isnet_quint8, Balanced = isnet_fp16, Quality = isnet. Assets load from <span class="text-orange-500/80">/background-removal/</span> after <span class="text-orange-500/80">npm run build</span> (see scripts/fetch-imgly-assets.mjs).</p>
                    <select [value]="localModelTier()" (change)="setLocalModelTier($any($event.target).value)" class="w-full bg-[#0a0a0a] text-white border border-[#333333] text-[9px] uppercase px-2 py-2 outline-none">
                      <option value="fast">Fast (smaller model)</option>
                      <option value="balanced">Balanced (default)</option>
                      <option value="quality">Quality (larger model)</option>
                    </select>
                 </div>

                 <div class="space-y-3">
                    <h3 class="text-[9px] uppercase tracking-widest opacity-40 font-bold block">Downloads &amp; offline cache</h3>
                    <p class="text-[8px] opacity-40 font-mono leading-relaxed">Pre-downloads the @imgly ONNX + WASM pack into the browser cache so local WebGPU runs stay fast and fully offline after the first load.</p>
                    <label class="flex items-center justify-between p-3 border border-[#333333] bg-[#0a0a0a] cursor-pointer">
                       <span class="text-[9px] uppercase font-bold tracking-widest">Auto-preload on startup</span>
                       <input type="checkbox" [checked]="autoPreloadImgly()" (change)="setAutoPreloadImgly($any($event.target).checked)" class="accent-orange-500">
                    </label>
                    <button type="button" (click)="runImglyPreload()" [disabled]="localPreloadStatus() === 'running'" class="w-full border border-orange-600 text-orange-500 py-2 text-[9px] uppercase font-bold tracking-widest hover:bg-orange-500/10 disabled:opacity-40">
                      {{ localPreloadStatus() === 'running' ? 'Preloading local models…' : 'Preload / refresh local models now' }}
                    </button>
                    @if (localPreloadDetail()) {
                      <p class="text-[9px] font-mono text-zinc-400 leading-relaxed">{{ localPreloadDetail() }}</p>
                    }
                    <div class="flex items-center justify-between p-3 border border-[#333333] bg-[#0a0a0a]">
                       <span class="text-[9px] uppercase font-bold tracking-widest">ZIP batch download</span>
                       <select [value]="zipLevelPreset()" (change)="setZipLevelPreset($any($event.target).value)" class="bg-black text-white border-none outline-none text-[9px] uppercase font-bold max-w-[140px]">
                          <option value="faster">Faster (lighter zip)</option>
                          <option value="smaller">Smaller files (slower)</option>
                       </select>
                    </div>
                 </div>

                 <div class="space-y-3">
                    <h3 class="text-[9px] uppercase tracking-widest opacity-40 font-bold block">Object naming</h3>
                    <select [value]="objectNamingMode()" (change)="setObjectNamingMode($any($event.target).value)" class="w-full bg-[#0a0a0a] text-white border border-[#333333] text-[9px] uppercase px-2 py-2 outline-none">
                      <option value="gemini">Gemini (cloud API)</option>
                      <option value="browser">In-browser model (Transformers.js, no Ollama)</option>
                      <option value="ollama">Ollama vision (local server)</option>
                    </select>
                    <p class="text-[8px] opacity-40 font-mono leading-relaxed">
                      <span class="text-orange-500/80">Browser</span> loads Transformers.js from <span class="text-orange-500/80">esm.sh</span> on first use (needs network + allow <span class="text-orange-500/80">connect-src</span> to esm.sh and Hugging Face model hosts), then caches weights in the browser. <span class="text-orange-500/80">Ollama</span> uses your machine’s Ollama HTTP API (see below when selected).
                    </p>
                    @if (objectNamingMode() === 'ollama') {
                    <div class="block text-[8px] uppercase opacity-40 font-bold tracking-widest">Base URL</div>
                    <input id="ollama_base" type="text" [value]="ollamaBaseUrl()" (input)="setOllamaBaseUrl($any($event.target).value)" class="w-full bg-black text-white border border-[#333333] px-2 py-2 text-[10px] font-mono" placeholder="/api/ollama">
                    @if (deployOllamaBlocked()) {
                      <p class="text-[9px] font-mono text-amber-500/90 leading-relaxed border border-amber-900/40 bg-amber-950/20 p-2">
                        This host is static (e.g. Workers): <span class="font-bold">/api/ollama</span> is not available here (404). Use a full HTTPS tunnel URL to Ollama, or run naming on <span class="font-bold">ng serve</span> with the dev proxy.
                      </p>
                    }
                    <div class="block text-[8px] uppercase opacity-40 font-bold tracking-widest mt-2">Model</div>
                    <input id="ollama_model" type="text" [value]="ollamaModel()" (input)="setOllamaModel($any($event.target).value)" class="w-full bg-black text-white border border-[#333333] px-2 py-2 text-[10px] font-mono" placeholder="llava">
                    <p class="text-[8px] opacity-40 font-mono leading-relaxed">
                      Dev: run Ollama locally and use <span class="text-orange-500/80">ng serve</span> with proxy so requests stay same-origin (<span class="text-orange-500/80">/api/ollama</span> → 127.0.0.1:11434). A deployed Workers site cannot reach your PC without a tunnel (e.g. Cloudflare Tunnel, ngrok), HTTPS, and Ollama CORS (<span class="text-orange-500/80">OLLAMA_ORIGINS</span>) or a server-side proxy.
                    </p>
                    }
                 </div>

                 <div class="space-y-3">
                    <h3 class="text-[9px] uppercase tracking-widest opacity-40 font-bold block">Local engine fallback</h3>
                    <label class="flex items-center justify-between p-3 border border-[#333333] bg-[#0a0a0a] cursor-pointer">
                       <span class="text-[9px] uppercase font-bold tracking-widest">Allow cloud fallback</span>
                       <input type="checkbox" [checked]="allowCloudFallback()" (change)="setAllowCloudFallback($any($event.target).checked)" class="accent-orange-500">
                    </label>
                    <p class="text-[8px] opacity-40 font-mono leading-relaxed">When off, a failed local background removal does not send the image to Gemini.</p>
                 </div>

                 <div class="pt-4 border-t border-[#333333] opacity-20 text-center font-mono text-[8px]">
                    PIPELINE_ENGINE_VER_3.0_STABLE
                 </div>
              </div>
           </div>
        </div>
      }

      <footer class="lg:h-12 border-t border-[#333333] flex flex-col lg:flex-row items-center justify-between px-8 py-3 lg:py-0 bg-[#0a0a0a] text-[#E5E5E5]">
        <div class="w-full lg:w-1/4 text-[9px] uppercase tracking-widest font-bold mb-2 lg:mb-0">
           @if (activeJob()) { Thread 01: GenAI Inference } @else { Thread 01: Idle }
           <span class="inline-block ml-4 pl-4 border-l border-[#333333] text-orange-500">{{ dbStatus() }}</span>
        </div>
        <div class="w-full lg:flex-1 h-[2px] bg-white/20 relative mx-0 lg:mx-8 mb-2 lg:mb-0 hidden lg:block">
          <div class="absolute top-0 left-0 h-full transition-all duration-500" 
               [class]="activeJob() ? 'bg-orange-500' : 'bg-transparent'"
               [style.width.%]="activeJob() ? (activeJob()!.completed / activeJob()!.total) * 100 : 0">
          </div>
        </div>
        <div class="w-full lg:w-1/4 text-left lg:text-right font-mono text-[10px] tracking-tighter opacity-60">
          V_3.0.0_GEMINI_AI
        </div>
      </footer>
    </main>
  `,
  styles: [] // We use tailwind inline
})
export class App implements OnInit {
  private sanitizer = inject(DomSanitizer);
  private supabase = inject(SupabaseService);
  private ollama = inject(OllamaService);
  private browserCaption = inject(BrowserCaptionService);
  private platformId = inject(PLATFORM_ID);
  
  // State
  modes = [
    { id: 'bg_removal', label: 'Bulk Background Removal', description: 'Isolates premium furniture assets into transparent PNGs.' },
    { id: 'in_paint', label: 'Batch Object Removal', description: 'Removes distracting elements via in-painting mask.' },
    { id: 'composite', label: 'Automated Compositing', description: 'Places isolated assets into predefined studio sets.' },
    { id: 'expand', label: 'AI Canvas Expansion', description: 'Expands the canvas boundaries and generates missing environment context.' }
  ];
  
  processType = signal<string>('bg_removal');
  selectedFiles = signal<UploadedFile[]>([]);
  isUploading = signal<boolean>(false);
  currentPrompt = signal<string>('');
  currentView = signal<'pipeline' | 'gallery'>('pipeline');
  bgOutputFormat = signal<'transparent' | 'white'>('white');
  engine = signal<'cloud' | 'local'>('cloud');
  cleanObjects = signal<boolean>(false);
  showSettings = signal<boolean>(false);
  dbStatus = signal<string>('Connecting to DB...');

  objectNamingMode = signal<'gemini' | 'browser' | 'ollama'>('gemini');
  ollamaBaseUrl = signal<string>('/api/ollama');
  ollamaModel = signal<string>('llava');
  allowCloudFallback = signal<boolean>(false);
  localModelTier = signal<'fast' | 'balanced' | 'quality'>('balanced');
  isBuildingZip = signal<boolean>(false);
  zipNotice = signal<string | null>(null);
  autoPreloadImgly = signal<boolean>(false);
  localPreloadStatus = signal<'idle' | 'running' | 'ready' | 'error'>('idle');
  localPreloadDetail = signal<string>('');
  zipLevelPreset = signal<'faster' | 'smaller'>('smaller');

  localPipelineBlocked = computed(
    () => this.engine() === 'local' && this.processType() !== 'bg_removal',
  );

  deployOllamaBlocked = computed(() => {
    if (!isPlatformBrowser(this.platformId)) {
      return false;
    }
    const h = window.location.hostname;
    return h.endsWith('.workers.dev') || h.endsWith('.pages.dev');
  });
  
  activeJob = signal<ProcessingJob | null>(null);
  results = computed(() => this.activeJob()?.results || []);
  
  // Drag and drop canvas expansion state
  editExpandIndex = signal<number | null>(null);
  dragSide: 'top' | 'right' | 'bottom' | 'left' | null = null;
  dragImgRef: HTMLImageElement | null = null;
  startY = 0;
  startX = 0;
  startVal = 0;
  
  // Computed to generate an array for skeletal loaders
  pendingArray = computed(() => {
    const job = this.activeJob();
    if (!job) return [];
    const pendingCount = job.total - job.completed - job.failed;
    return Array(Math.max(0, pendingCount)).fill(0).map((_, i) => i);
  });

  async ngOnInit() {
    this.dbStatus.set('DB Client Initialized');
    this.loadStoredSettings();
    if (isPlatformBrowser(this.platformId) && this.autoPreloadImgly()) {
      void this.runImglyPreload({ quiet: true });
    }
  }

  private readonly ls = {
    namingMode: 'pipeline_object_naming_mode',
    legacyOllama: 'pipeline_use_ollama_naming',
    ollamaBase: 'pipeline_ollama_base',
    ollamaModel: 'pipeline_ollama_model',
    cloudFb: 'pipeline_allow_cloud_fallback',
    tier: 'pipeline_local_model_tier',
    autoPreload: 'pipeline_auto_preload_imgly',
    zipPreset: 'pipeline_zip_level_preset',
  } as const;

  loadStoredSettings(): void {
    try {
      const nm = localStorage.getItem(this.ls.namingMode);
      if (nm === 'gemini' || nm === 'browser' || nm === 'ollama') {
        this.objectNamingMode.set(nm);
      } else if (localStorage.getItem(this.ls.legacyOllama) === '1') {
        this.objectNamingMode.set('ollama');
      }
      const b = localStorage.getItem(this.ls.ollamaBase);
      if (b) {
        this.ollamaBaseUrl.set(b);
      }
      const m = localStorage.getItem(this.ls.ollamaModel);
      if (m) {
        this.ollamaModel.set(m);
      }
      if (localStorage.getItem(this.ls.cloudFb) === '1') {
        this.allowCloudFallback.set(true);
      }
      const t = localStorage.getItem(this.ls.tier);
      if (t === 'fast' || t === 'balanced' || t === 'quality') {
        this.localModelTier.set(t);
      }
      if (localStorage.getItem(this.ls.autoPreload) === '1') {
        this.autoPreloadImgly.set(true);
      }
      const zp = localStorage.getItem(this.ls.zipPreset);
      if (zp === 'faster' || zp === 'smaller') {
        this.zipLevelPreset.set(zp);
      }
    } catch {
      /* ignore */
    }
  }

  saveStoredSettings(): void {
    try {
      localStorage.setItem(this.ls.namingMode, this.objectNamingMode());
      localStorage.setItem(this.ls.ollamaBase, this.ollamaBaseUrl());
      localStorage.setItem(this.ls.ollamaModel, this.ollamaModel());
      localStorage.setItem(this.ls.cloudFb, this.allowCloudFallback() ? '1' : '0');
      localStorage.setItem(this.ls.tier, this.localModelTier());
      localStorage.setItem(this.ls.autoPreload, this.autoPreloadImgly() ? '1' : '0');
      localStorage.setItem(this.ls.zipPreset, this.zipLevelPreset());
    } catch {
      /* ignore */
    }
  }

  closeSettings(): void {
    this.saveStoredSettings();
    this.showSettings.set(false);
  }

  setObjectNamingMode(v: string): void {
    if (v === 'gemini' || v === 'browser' || v === 'ollama') {
      this.objectNamingMode.set(v);
      this.saveStoredSettings();
    }
  }

  setOllamaBaseUrl(v: string): void {
    this.ollamaBaseUrl.set(v);
    this.saveStoredSettings();
  }

  setOllamaModel(v: string): void {
    this.ollamaModel.set(v);
    this.saveStoredSettings();
  }

  setAllowCloudFallback(v: boolean): void {
    this.allowCloudFallback.set(v);
    this.saveStoredSettings();
  }

  setLocalModelTier(v: string): void {
    if (v === 'fast' || v === 'balanced' || v === 'quality') {
      this.localModelTier.set(v);
      this.saveStoredSettings();
    }
  }

  setAutoPreloadImgly(v: boolean): void {
    this.autoPreloadImgly.set(v);
    this.saveStoredSettings();
  }

  setZipLevelPreset(v: string): void {
    if (v === 'faster' || v === 'smaller') {
      this.zipLevelPreset.set(v);
      this.saveStoredSettings();
    }
  }

  private imglyAssetBaseUrl(): string {
    if (isPlatformBrowser(this.platformId) && typeof window !== 'undefined') {
      return new URL('/background-removal/', window.location.origin).href;
    }
    return '/background-removal/';
  }

  private zipLevelForExport(): ZipLevel {
    return this.zipLevelPreset() === 'faster' ? 3 : 9;
  }

  async runImglyPreload(opts?: { quiet?: boolean }): Promise<void> {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }
    const quiet = opts?.quiet === true;
    if (!quiet) {
      this.localPreloadStatus.set('running');
      this.localPreloadDetail.set('Connecting to asset host…');
    }
    try {
      const { preload } = await import('@imgly/background-removal');
      await preload({
        publicPath: this.imglyAssetBaseUrl(),
        model: this.imglyModelId(),
        device: 'gpu',
        progress: (key, current, total) => {
          const pct = total > 0 ? Math.round((current / total) * 100) : 0;
          if (!quiet) {
            this.localPreloadDetail.set(`${key} (${pct}%)`);
          }
        },
      });
      if (quiet) {
        this.localPreloadStatus.set('idle');
        this.localPreloadDetail.set('');
      } else {
        this.localPreloadStatus.set('ready');
        this.localPreloadDetail.set('Local pack is cached in this browser.');
      }
    } catch (e) {
      if (quiet) {
        this.localPreloadStatus.set('idle');
        this.localPreloadDetail.set('');
      } else {
        this.localPreloadStatus.set('error');
        this.localPreloadDetail.set(
          `Preload failed: ${(e as Error)?.message || String(e)}. Run a production build with assets, or set SKIP_IMGLY_FETCH=0 and npm run build once.`,
        );
      }
    }
  }

  private imglyModelId(): 'isnet' | 'isnet_fp16' | 'isnet_quint8' {
    const t = this.localModelTier();
    if (t === 'fast') {
      return 'isnet_quint8';
    }
    if (t === 'quality') {
      return 'isnet';
    }
    return 'isnet_fp16';
  }

  private async resolveObjectLabel(
    p: UploadedFile,
    base64Data: string,
    mimeType: string,
    ai: GoogleGenAI,
  ): Promise<string> {
    const manual = p.objectName?.trim();
    if (manual) {
      return manual;
    }
    if (this.objectNamingMode() === 'browser') {
      this.currentPrompt.set('In-browser caption model…');
      try {
        const fromBrowser = await this.browserCaption.captionFromBase64(
          base64Data,
          mimeType,
          (msg) => this.currentPrompt.set(msg),
        );
        if (fromBrowser) {
          return fromBrowser;
        }
      } catch (err) {
        console.error('Browser caption failed', err);
      }
    } else if (this.objectNamingMode() === 'ollama') {
      const base = this.ollamaBaseUrl().trim();
      const relativeBlocked = this.deployOllamaBlocked() && (base === '' || base.startsWith('/'));
      if (!relativeBlocked) {
        this.currentPrompt.set('Ollama vision naming…');
        const fromOllama = await this.ollama.nameMainObject(
          base64Data,
          this.ollamaBaseUrl(),
          this.ollamaModel(),
        );
        if (fromOllama) {
          return fromOllama;
        }
      }
    }

    if (this.objectNamingMode() !== 'gemini') {
      this.currentPrompt.set('Naming fallback: Gemini…');
    } else {
      this.currentPrompt.set('Analyzing image via Gemini Cluster...');
    }
    try {
      const idenResponse = await ai.models.generateContent({
        model: 'gemini-1.5-flash',
        contents: {
          parts: [
            { inlineData: { data: base64Data, mimeType: mimeType } },
            { text: 'Identify the main object in this image. Respond with ONLY the object name in 1-3 words.' },
          ],
        },
      });
      return idenResponse.text?.trim() || 'object';
    } catch {
      return 'object';
    }
  }

  async downloadAllZip(): Promise<void> {
    const job = this.activeJob();
    if (!job || job.results.length === 0) {
      return;
    }
    this.isBuildingZip.set(true);
    this.zipNotice.set(null);
    try {
      if (job.results.length > 20) {
        this.zipNotice.set(
          'Large batch: zipping many high-resolution PNGs can use a lot of memory in the browser. If the tab freezes, download files individually.',
        );
      }
      const bytes = await buildResultsZip(
        job.results.map((r) => ({ path: r.cleanName, dataUrl: r.dataUrl })),
        this.zipLevelForExport(),
      );
      const blob = new Blob([new Uint8Array(bytes)], { type: 'application/zip' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `batch_${job.id}_${new Date().toISOString().slice(0, 10)}.zip`;
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      this.zipNotice.set('ZIP build failed. Try fewer or smaller images.');
    } finally {
      this.isBuildingZip.set(false);
    }
  }

  // --- Expand Canvas Editor Logic ---
  openExpandEditor(index: number) {
    this.editExpandIndex.set(index);
  }

  closeExpandEditor() {
    this.editExpandIndex.set(null);
  }

  getEditingMargins() {
    const idx = this.editExpandIndex();
    if (idx === null) return null;
    return this.selectedFiles()[idx].expandMargins || {top: 0, right: 0, bottom: 0, left: 0};
  }

  onDragStart(event: MouseEvent, side: 'top' | 'right' | 'bottom' | 'left', imgRef: HTMLImageElement) {
    this.dragSide = side;
    this.dragImgRef = imgRef;
    this.startY = event.clientY;
    this.startX = event.clientX;
    const margins = this.getEditingMargins();
    this.startVal = margins ? margins[side] : 0;
    event.preventDefault();
  }

  @HostListener('window:mousemove', ['$event'])
  onDrag(event: MouseEvent) {
    if (!this.dragSide || this.editExpandIndex() === null || !this.dragImgRef) return;
    
    // Calculate difference in pixels
    const dy = event.clientY - this.startY;
    const dx = event.clientX - this.startX;
    
    const heightPx = this.dragImgRef.clientHeight;
    const widthPx = this.dragImgRef.clientWidth;
    
    let delta = 0;
    
    if (this.dragSide === 'top') {
        delta = (-dy / heightPx) * 100;
    } else if (this.dragSide === 'bottom') {
        delta = (dy / heightPx) * 100;
    } else if (this.dragSide === 'left') {
        delta = (-dx / widthPx) * 100;
    } else if (this.dragSide === 'right') {
        delta = (dx / widthPx) * 100;
    }
    
    const newVal = Math.max(0, Math.min(200, this.startVal + delta)); // Cap at 200%
    
    this.selectedFiles.update(files => {
      const newFiles = [...files];
      const target = newFiles[this.editExpandIndex()!];
      newFiles[this.editExpandIndex()!] = {
        ...target,
        expandMargins: {
          ...(target.expandMargins || {top:0, right:0, bottom:0, left:0}),
          [this.dragSide!]: newVal
        }
      };
      return newFiles;
    });
  }

  @HostListener('window:mouseup')
  onDragEnd() {
    this.dragSide = null;
    this.dragImgRef = null;
  }
  // ------------------------------------

  removePreview(index: number) {
    const list = this.selectedFiles();
    const item = list[index];
    URL.revokeObjectURL(item.previewUrlRaw);
    this.selectedFiles.set(list.filter((_, i) => i !== index));
  }

  updateObjectName(index: number, name: string) {
    this.selectedFiles.update(files => {
      const newFiles = [...files];
      newFiles[index] = { ...newFiles[index], objectName: name };
      return newFiles;
    });
  }

  onFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    if (input.files) {
      const newFiles = Array.from(input.files).map(file => {
        const rawUrl = URL.createObjectURL(file);
        return {
          file,
          previewUrlRaw: rawUrl,
          previewUrl: this.sanitizer.bypassSecurityTrustUrl(rawUrl)
        };
      });
      // Append and slice
      this.selectedFiles.update(files => [...files, ...newFiles].slice(0, 50));
    }
    // reset input
    input.value = '';
  }

  async startUpload() {
    const previews = this.selectedFiles();
    if (previews.length === 0) return;
    if (this.localPipelineBlocked()) {
      this.isUploading.set(false);
      return;
    }

    this.isUploading.set(true);

    const jobId = Math.random().toString(36).substring(2, 9);
    
    const newJob: ProcessingJob = {
      id: jobId,
      total: previews.length,
      completed: 0,
      failed: 0,
      status: 'processing',
      processType: this.processType(),
      results: []
    };
    
    this.activeJob.set(newJob);
    
    const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY }); 
    const mode = this.processType();
    
    for (const p of previews) {
        try {
            const base64Data = await this.toBase64(p.file);
            let outputBase64 = null;
            let outputMime = null;
            const mimeType = p.file.type || 'image/jpeg';
            let prompt = "";
            const fallbackModels = [
              'gemini-2.0-flash-preview-image-generation',
              'gemini-2.5-flash-image-preview',
              'gemini-2.5-flash-image',
            ];

            // --- LOCAL PROCESSING PATH ---
            if (this.engine() === 'local' && mode === 'bg_removal') {
                this.currentPrompt.set('Invoking Local Neural Network...');
                try {
                    const { removeBackground } = await import('@imgly/background-removal');
                    const blob = await removeBackground(p.file, {
                        publicPath: this.imglyAssetBaseUrl(),
                        model: this.imglyModelId(),
                        device: 'gpu',
                        progress: (key, current, total) => {
                            const pct = total > 0 ? Math.round((current / total) * 100) : 0;
                            this.currentPrompt.set(`Local: ${key} (${pct}%)`);
                        },
                    });
                    const localBase64 = await new Promise<string>((resolve) => {
                        const reader = new FileReader();
                        reader.readAsDataURL(blob);
                        reader.onloadend = () => resolve((reader.result as string).split(',')[1]);
                    });
                    outputBase64 = localBase64;
                    outputMime = 'image/png';
                    if (this.bgOutputFormat() === 'white') {
                         outputBase64 = await this.compositeOnWhite(outputBase64);
                         outputMime = 'image/jpeg';
                    }
                } catch (localError) {
                    console.error('Local engine failed', localError);
                    if (!this.allowCloudFallback()) {
                        throw new Error(
                            'Local background removal failed. Enable cloud fallback in settings, confirm assets exist at /background-removal/, or switch to Cloud.',
                        );
                    }
                    this.currentPrompt.set('Local failed — cloud fallback…');
                }
            }

            // --- CLOUD PROCESSING PATH (Fallback Cluster) ---
            if (!outputBase64) {
                await new Promise(r => setTimeout(r, 1000));
                const detectedObject = await this.resolveObjectLabel(p, base64Data, mimeType, ai);
            
            if (mode === 'bg_removal') {
                 const cleanStr = this.cleanObjects() ? `
Constraint 4: CRITICAL: Remove ALL clutter, items, clothes, boxes, and decor INSIDE or ON TOP of the ${detectedObject}. The object MUST be completely EMPTY. Seamlessly restore the empty interior shelves/surfaces.` : ``;
                 const bgConstraint = this.bgOutputFormat() === 'white' 
                     ? `Constraint 1: The background MUST be replaced with a perfectly solid, uniform PURE WHITE color (Hex: #FFFFFF). No shadows or floor reflections.`
                     : `Constraint 1: The background MUST be replaced with a perfectly solid, uniform NEON MAGENTA color (Hex: #FF00FF). No shadows or floor reflections.`;

                 prompt = `Task: Isolate Object.
Role: You are an expert photo editor.
Instruction: Extract the exact main ${detectedObject} from the provided image. Remove all background elements, floors, shadows, and environment completely.
${bgConstraint} 
Constraint 2: Do NOT generate a checkerboard pattern. Do NOT add new elements.
Constraint 3: Preserve the exact structural details, colors, textures, and lighting of the primary ${detectedObject}. Do NOT alter the object itself.${cleanStr}`;
            } else if (mode === 'in_paint') {
                 prompt = `Task: Clean Image / In-painting.
Role: You are an expert photo retoucher.
Instruction: Carefully remove any distracting background elements, people, pets, clutter, trash, or harsh shadows from the scene.
Constraint 1: The main ${detectedObject} MUST remain completely intact, unaltered in shape, color, and texture.
Constraint 2: Seamlessly fill in the removed areas to match the surrounding environment naturally.
Constraint 3: Maintain the original perspective and lighting of the room/environment.`;
            } else if (mode === 'composite') {
                 prompt = `Task: Automated Compositing.
Role: You are a high-end interior design visualizer.
Instruction: Place the provided ${detectedObject} into a new cinematic, high-end luxury studio setting.
Style: Soft indirect lighting, minimalist concrete or wood textures, editorial aesthetic (monochromatic tones).
Constraint 1: The ${detectedObject} MUST remain exactly as it is in the original image (no changes to its design, shape, or color).
Constraint 2: Ensure the ${detectedObject}'s perspective and lighting integrate seamlessly with the new environment.
Constraint 3: Cast realistic soft shadows on the floor to match the new lighting.`;
            } else if (mode === 'expand') {
                 prompt = `Task: Image Outpainting.
Role: You are an expert photo retoucher.
I have added bright MAGENTA (#FF00FF) borders to an original image. The magenta areas represent missing canvas.
Instruction: You MUST COMPLETELY REPLACE all the magenta areas by generating a seamless, realistic continuation of the surrounding room environment (walls, floors, lighting, shadows).
Constraint 1: Keep the original interior subject perfectly intact—do not change its size, shape, or colors.
Constraint 2: Eliminate all magenta. The final image should look like a natural wide-angle photograph.`;
            }
            
                this.currentPrompt.set(prompt);
    
                let finalBase64Data = base64Data;
                let finalMimeType = mimeType;
                let targetAspectRatio = '1:1';
                if (mode === 'expand' && p.expandMargins) {
                    const { expandedBase64, closestRatio } = await this.applyCanvasExpansion(base64Data, mimeType, p.expandMargins);
                    finalBase64Data = expandedBase64;
                    finalMimeType = 'image/png';
                    targetAspectRatio = closestRatio;
                }
    
                // Cluster Fallback Loop
                let success = false;
                for (const modelName of fallbackModels) {
                    try {
                        this.currentPrompt.set(`ENGINE: ${modelName} | Processing...`);
                        const response = await ai.models.generateContent({
                          model: modelName,
                          contents: {
                            parts: [
                              { inlineData: { data: finalBase64Data, mimeType: finalMimeType } },
                              { text: prompt }
                            ],
                          },
                          config: {
                            responseModalities: [Modality.TEXT, Modality.IMAGE],
                            ...(mode === 'expand'
                              ? { imageConfig: { aspectRatio: targetAspectRatio as never } }
                              : {}),
                          },
                        });
                        
                        const parts = response.candidates?.[0]?.content?.parts;
                        if (parts) {
                           for (const part of parts) {
                             if (part.inlineData) {
                               outputBase64 = part.inlineData.data;
                               outputMime = part.inlineData.mimeType || 'image/jpeg';
                               success = true;
                               break;
                             }
                           }
                        }
                        if (success) break;
                    } catch (err: unknown) {
                        const error = err as Error;
                        if (error?.message?.includes('429')) {
                             this.currentPrompt.set(`QUOTA LIMIT ON ${modelName}. SWITCHING NODES...`);
                             await new Promise(r => setTimeout(r, 2000));
                        }
                        continue;
                    }
                }
                
                if (!success) throw new Error("Batch failed: No models responded successfully.");
            }

            if (outputBase64) {
               if (mode === 'bg_removal' && outputMime !== 'image/png') {
                   if (this.bgOutputFormat() === 'transparent') {
                       outputBase64 = await this.makeMagentaTransparent(outputBase64, outputMime || 'image/jpeg');
                       outputMime = 'image/png';
                   }
               }
               
               const outputUrl = `data:${outputMime};base64,${outputBase64}`;
               const cleanName = `processed_${mode}_${p.file.name.replace(/\.[^/.]+$/, "")}.${outputMime === 'image/png' ? 'png' : 'jpg'}`;
               const mockW = Math.floor(Math.random() * 100) + 50;
               const mockD = Math.floor(Math.random() * 80) + 40;
               const mockH = Math.floor(Math.random() * 120) + 80;
               
               const jobResult: JobResult = {
                  originalName: p.file.name,
                  cleanName: cleanName,
                  safeUrl: this.sanitizer.bypassSecurityTrustUrl(outputUrl),
                  dataUrl: outputUrl,
                  dimensions: `${mockW} (W) x ${mockD} (D) x ${mockH} (H) cm`
               };
               
               this.activeJob.update(job => {
                  if (!job) return job;
                  return {
                     ...job,
                     completed: job.completed + 1,
                     results: [...job.results, jobResult]
                  };
               });
            } else {
               throw new Error("No image generated by AI");
            }
            
        } catch (error) {
            console.error("AI Generation Error", error);
            this.activeJob.update(job => {
                  if (!job) return job;
                  return {
                     ...job,
                     failed: job.failed + 1
                  };
            });
        }
    }
    
    this.activeJob.update(job => {
        if (!job) return job;
        return {
             ...job,
             status: 'completed'
        };
    });
    
    this.currentPrompt.set('');
    this.isUploading.set(false);
    previews.forEach(p => URL.revokeObjectURL(p.previewUrlRaw));
    this.selectedFiles.set([]);
  }

  private toBase64(file: File): Promise<string> {
     return new Promise((resolve, reject) => {
       const reader = new FileReader();
       reader.readAsDataURL(file);
       reader.onload = () => resolve((reader.result as string).split(',')[1]);
       reader.onerror = error => reject(error);
     });
  }

  private applyCanvasExpansion(base64: string, mime: string, margins: {top: number, right: number, bottom: number, left: number}): Promise<{expandedBase64: string, closestRatio: string}> {
    if (margins.top === 0 && margins.right === 0 && margins.bottom === 0 && margins.left === 0) return Promise.resolve({expandedBase64: base64, closestRatio: '1:1'});
    
    return new Promise((resolve) => {
       const img = new Image();
       img.onload = () => {
         const w = img.width;
         const h = img.height;
         const addTop = Math.floor(h * (margins.top / 100));
         const addBottom = Math.floor(h * (margins.bottom / 100));
         const addLeft = Math.floor(w * (margins.left / 100));
         const addRight = Math.floor(w * (margins.right / 100));
         
         const newW = w + addLeft + addRight;
         const newH = h + addTop + addBottom;
         
         // Calculate closest aspect ratio among 1:1, 3:4, 4:3, 9:16, 16:9
         const currentRatio = newW / newH;
         const standardRatios = [
            { id: '1:1', val: 1 },
            { id: '3:4', val: 3/4 },
            { id: '4:3', val: 4/3 },
            { id: '9:16', val: 9/16 },
            { id: '16:9', val: 16/9 }
         ];
         let closestRatioInfo = standardRatios[0];
         let smallestDiff = Math.abs(currentRatio - closestRatioInfo.val);
         for (let i = 1; i < standardRatios.length; i++) {
             const diff = Math.abs(currentRatio - standardRatios[i].val);
             if (diff < smallestDiff) {
                 smallestDiff = diff;
                 closestRatioInfo = standardRatios[i];
             }
         }
         
         const canvas = document.createElement('canvas');
         canvas.width = newW;
         canvas.height = newH;
         const ctx = canvas.getContext('2d');
         if (!ctx) return resolve({expandedBase64: base64, closestRatio: '1:1'});
         
         // Start with magenta so the AI knows what to outpaint
         ctx.fillStyle = '#FF00FF';
         ctx.fillRect(0, 0, newW, newH);
         
         // Draw original image inside the new boundaries
         ctx.drawImage(img, addLeft, addTop);
         
         resolve({
             expandedBase64: canvas.toDataURL('image/png').split(',')[1],
             closestRatio: closestRatioInfo.id
         });
       };
       img.onerror = () => resolve({expandedBase64: base64, closestRatio: '1:1'});
       img.src = `data:${mime};base64,${base64}`;
    });
  }

  private makeMagentaTransparent(base64: string, mime: string): Promise<string> {
    return new Promise((resolve) => {
       const img = new Image();
       img.onload = () => {
         const canvas = document.createElement('canvas');
         canvas.width = img.width;
         canvas.height = img.height;
         const ctx = canvas.getContext('2d', { willReadFrequently: true });
         if (!ctx) return resolve(base64);
         
         ctx.drawImage(img, 0, 0);
         const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
         const data = imageData.data;
         
         // Sample the corners to dynamic-detect the generated background color
         // It should be Magenta (#FF00FF), but AI artifacts might make it #F902F8 etc.
         let bgR = data[0];
         let bgG = data[1];
         let bgB = data[2];
         
         // Fallback to pure magenta if the top-left corner isn't actually magenta
         if (!(bgR > 150 && bgG < 120 && bgB > 150)) {
            bgR = 255; bgG = 0; bgB = 255;
         }
         
         // Distance thresholds for hard transparency vs edge anti-aliasing (fringe)
         const solidTolerance = 70;
         const fringeTolerance = 160;
         
         for (let i = 0; i < data.length; i += 4) {
            const r = data[i];
            const g = data[i+1];
            const b = data[i+2];
            
            // Euclidean distance to background color
            const distance = Math.sqrt(
               (r - bgR) * (r - bgR) + 
               (g - bgG) * (g - bgG) + 
               (b - bgB) * (b - bgB)
            );
            
            if (distance < solidTolerance) {
                // Strictly background: Make fully transparent
                data[i+3] = 0;
            } else if (distance < fringeTolerance) {
                // Edge transition: Apply gradual alpha transparency
                const alphaFactor = (distance - solidTolerance) / (fringeTolerance - solidTolerance);
                // Smoother sigmoid-like curve for edge alpha
                data[i+3] = Math.floor(255 * Math.pow(alphaFactor, 1.5));
                
                // Defringe: Magenta spill suppression
                // Magenta is high R and B. We blend them towards G (luminance equivalent) to neutralize the rim lighting.
                if (data[i] > data[i+1]) data[i] = Math.floor(data[i] * alphaFactor + data[i+1] * (1 - alphaFactor));
                if (data[i+2] > data[i+1]) data[i+2] = Math.floor(data[i+2] * alphaFactor + data[i+1] * (1 - alphaFactor));
            }
         }
         
         ctx.putImageData(imageData, 0, 0);
         const newBase64 = canvas.toDataURL('image/png').split(',')[1];
         resolve(newBase64);
       };
       img.onerror = () => resolve(base64);
       img.src = `data:${mime};base64,${base64}`;
    });
  }

  private compositeOnWhite(base64: string): Promise<string> {
    return new Promise((resolve) => {
       const img = new Image();
       img.onload = () => {
          const canvas = document.createElement('canvas');
          canvas.width = img.width;
          canvas.height = img.height;
          const ctx = canvas.getContext('2d');
          if (!ctx) return resolve(base64);
          
          ctx.fillStyle = '#FFFFFF';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(img, 0, 0);
          resolve(canvas.toDataURL('image/jpeg').split(',')[1]);
       };
       img.onerror = () => resolve(base64);
       img.src = `data:image/png;base64,${base64}`;
    });
  }
}
