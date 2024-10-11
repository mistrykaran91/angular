/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.dev/license
 */

import {ChangeDetectorRef, Component, inject, OnInit} from '@angular/core';
import {Events, MessageBus} from 'protocol';

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss'],
  standalone: false,
})
export class AppComponent implements OnInit {
  private _cd = inject(ChangeDetectorRef);
  private readonly _messageBus = inject<MessageBus<Events>>(MessageBus);
  private onProfilingStartedListener = () => {
    this._messageBus.emit('enableTimingAPI');
  };
  private onProfilingStoppedListener = () => {
    this._messageBus.emit('disableTimingAPI');
  };
  ngOnInit(): void {
    chrome.devtools.network.onNavigated.addListener(() => {
      window.location.reload();
    });
    const chromeDevToolsPerformance = chrome.devtools.performance;
    chromeDevToolsPerformance?.onProfilingStarted?.addListener?.(this.onProfilingStartedListener);
    chromeDevToolsPerformance?.onProfilingStopped?.addListener?.(this.onProfilingStoppedListener);

    this._cd.detectChanges();
  }
  ngOnDestroy(): void {
    const chromeDevToolsPerformance = chrome.devtools.performance;
    chromeDevToolsPerformance?.onProfilingStarted?.removeListener?.(
      this.onProfilingStartedListener,
    );
    chromeDevToolsPerformance?.onProfilingStopped?.removeListener?.(
      this.onProfilingStoppedListener,
    );
  }
}
