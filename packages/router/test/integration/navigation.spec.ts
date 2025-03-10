/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.dev/license
 */

import {Component, inject as coreInject, NgModule} from '@angular/core';
import {Location} from '@angular/common';
import {fakeAsync, TestBed, tick, inject} from '@angular/core/testing';
import {
  provideRouter,
  Navigation,
  withRouterConfig,
  Router,
  NavigationStart,
  NavigationEnd,
  RouterLink,
  ActivatedRoute,
  Params,
  RouterModule,
} from '../../src';
import {
  RootCmp,
  SimpleCmp,
  onlyNavigationStartAndEnd,
  expectEvents,
  RelativeLinkCmp,
  createRoot,
  advance,
} from './integration_helpers';

export function navigationIntegrationTestSuite() {
  describe('navigation', () => {
    it('should navigate to the current URL', fakeAsync(() => {
      TestBed.configureTestingModule({
        providers: [provideRouter([], withRouterConfig({onSameUrlNavigation: 'reload'}))],
      });
      const router = TestBed.inject(Router);
      router.resetConfig([
        {path: '', component: SimpleCmp},
        {path: 'simple', component: SimpleCmp},
      ]);

      const events: (NavigationStart | NavigationEnd)[] = [];
      router.events.subscribe((e) => onlyNavigationStartAndEnd(e) && events.push(e));

      router.navigateByUrl('/simple');
      tick();

      router.navigateByUrl('/simple');
      tick();

      expectEvents(events, [
        [NavigationStart, '/simple'],
        [NavigationEnd, '/simple'],
        [NavigationStart, '/simple'],
        [NavigationEnd, '/simple'],
      ]);
    }));

    it('should override default onSameUrlNavigation with extras', async () => {
      TestBed.configureTestingModule({
        providers: [provideRouter([], withRouterConfig({onSameUrlNavigation: 'ignore'}))],
      });
      const router = TestBed.inject(Router);
      router.resetConfig([
        {path: '', component: SimpleCmp},
        {path: 'simple', component: SimpleCmp},
      ]);

      const events: (NavigationStart | NavigationEnd)[] = [];
      router.events.subscribe((e) => onlyNavigationStartAndEnd(e) && events.push(e));

      await router.navigateByUrl('/simple');
      await router.navigateByUrl('/simple');
      // By default, the second navigation is ignored
      expectEvents(events, [
        [NavigationStart, '/simple'],
        [NavigationEnd, '/simple'],
      ]);
      await router.navigateByUrl('/simple', {onSameUrlNavigation: 'reload'});
      // We overrode the `onSameUrlNavigation` value. This navigation should be processed.
      expectEvents(events, [
        [NavigationStart, '/simple'],
        [NavigationEnd, '/simple'],
        [NavigationStart, '/simple'],
        [NavigationEnd, '/simple'],
      ]);
    });

    it('should override default onSameUrlNavigation with extras', async () => {
      TestBed.configureTestingModule({
        providers: [provideRouter([], withRouterConfig({onSameUrlNavigation: 'reload'}))],
      });
      const router = TestBed.inject(Router);
      router.resetConfig([
        {path: '', component: SimpleCmp},
        {path: 'simple', component: SimpleCmp},
      ]);

      const events: (NavigationStart | NavigationEnd)[] = [];
      router.events.subscribe((e) => onlyNavigationStartAndEnd(e) && events.push(e));

      await router.navigateByUrl('/simple');
      await router.navigateByUrl('/simple');
      expectEvents(events, [
        [NavigationStart, '/simple'],
        [NavigationEnd, '/simple'],
        [NavigationStart, '/simple'],
        [NavigationEnd, '/simple'],
      ]);

      events.length = 0;
      await router.navigateByUrl('/simple', {onSameUrlNavigation: 'ignore'});
      expectEvents(events, []);
    });

    it('should set transient navigation info', async () => {
      let observedInfo: unknown;
      const router = TestBed.inject(Router);
      router.resetConfig([
        {
          path: 'simple',
          component: SimpleCmp,
          canActivate: [
            () => {
              observedInfo = coreInject(Router).getCurrentNavigation()?.extras?.info;
              return true;
            },
          ],
        },
      ]);

      await router.navigateByUrl('/simple', {info: 'navigation info'});
      expect(observedInfo).toEqual('navigation info');
    });

    it('should set transient navigation info for routerlink', async () => {
      let observedInfo: unknown;
      const router = TestBed.inject(Router);
      router.resetConfig([
        {
          path: 'simple',
          component: SimpleCmp,
          canActivate: [
            () => {
              observedInfo = coreInject(Router).getCurrentNavigation()?.extras?.info;
              return true;
            },
          ],
        },
      ]);
      @Component({
        imports: [RouterLink],
        template: `<a #simpleLink [routerLink]="'/simple'" [info]="simpleLink"></a>`,
      })
      class App {}

      const fixture = TestBed.createComponent(App);
      fixture.autoDetectChanges();
      const anchor = fixture.nativeElement.querySelector('a');
      anchor.click();
      await fixture.whenStable();

      // An example use-case might be to pass the clicked link along with the navigation
      // information
      expect(observedInfo).toBeInstanceOf(HTMLAnchorElement);
    });

    it('should make transient navigation info available in redirect', async () => {
      let observedInfo: unknown;
      const router = TestBed.inject(Router);
      router.resetConfig([
        {
          path: 'redirect',
          component: SimpleCmp,
          canActivate: [() => coreInject(Router).parseUrl('/simple')],
        },
        {
          path: 'simple',
          component: SimpleCmp,
          canActivate: [
            () => {
              observedInfo = coreInject(Router).getCurrentNavigation()?.extras?.info;
              return true;
            },
          ],
        },
      ]);

      await router.navigateByUrl('/redirect', {info: 'navigation info'});
      expect(observedInfo).toBe('navigation info');
      expect(router.url).toEqual('/simple');
    });

    it('should ignore empty paths in relative links', fakeAsync(
      inject([Router], (router: Router) => {
        router.resetConfig([
          {
            path: 'foo',
            children: [{path: 'bar', children: [{path: '', component: RelativeLinkCmp}]}],
          },
        ]);

        const fixture = createRoot(router, RootCmp);

        router.navigateByUrl('/foo/bar');
        advance(fixture);

        const link = fixture.nativeElement.querySelector('a');
        expect(link.getAttribute('href')).toEqual('/foo/simple');
      }),
    ));

    it('should set the restoredState to null when executing imperative navigations', fakeAsync(
      inject([Router], (router: Router) => {
        router.resetConfig([
          {path: '', component: SimpleCmp},
          {path: 'simple', component: SimpleCmp},
        ]);

        const fixture = createRoot(router, RootCmp);
        let event: NavigationStart;
        router.events.subscribe((e) => {
          if (e instanceof NavigationStart) {
            event = e;
          }
        });

        router.navigateByUrl('/simple');
        tick();

        expect(event!.navigationTrigger).toEqual('imperative');
        expect(event!.restoredState).toEqual(null);
      }),
    ));

    it('should set history.state if passed using imperative navigation', fakeAsync(
      inject([Router, Location], (router: Router, location: Location) => {
        router.resetConfig([
          {path: '', component: SimpleCmp},
          {path: 'simple', component: SimpleCmp},
        ]);

        const fixture = createRoot(router, RootCmp);
        let navigation: Navigation = null!;
        router.events.subscribe((e) => {
          if (e instanceof NavigationStart) {
            navigation = router.getCurrentNavigation()!;
          }
        });

        router.navigateByUrl('/simple', {state: {foo: 'bar'}});
        tick();

        const state = location.getState() as any;
        expect(state.foo).toBe('bar');
        expect(state).toEqual({foo: 'bar', navigationId: 2});
        expect(navigation.extras.state).toBeDefined();
        expect(navigation.extras.state).toEqual({foo: 'bar'});
      }),
    ));

    it('should set history.state when navigation with browser back and forward', fakeAsync(
      inject([Router, Location], (router: Router, location: Location) => {
        router.resetConfig([
          {path: '', component: SimpleCmp},
          {path: 'simple', component: SimpleCmp},
        ]);

        const fixture = createRoot(router, RootCmp);
        let navigation: Navigation = null!;
        router.events.subscribe((e) => {
          if (e instanceof NavigationStart) {
            navigation = <Navigation>router.getCurrentNavigation()!;
          }
        });

        let state: Record<string, string> = {foo: 'bar'};
        router.navigateByUrl('/simple', {state});
        tick();
        location.back();
        tick();
        location.forward();
        tick();

        expect(navigation.extras.state).toBeDefined();
        expect(navigation.extras.state).toEqual(state);

        // Manually set state rather than using navigate()
        state = {bar: 'foo'};
        location.replaceState(location.path(), '', state);
        location.back();
        tick();
        location.forward();
        tick();

        expect(navigation.extras.state).toBeDefined();
        expect(navigation.extras.state).toEqual(state);
      }),
    ));

    it('should navigate correctly when using `Location#historyGo', fakeAsync(
      inject([Router, Location], (router: Router, location: Location) => {
        router.resetConfig([
          {path: 'first', component: SimpleCmp},
          {path: 'second', component: SimpleCmp},
        ]);

        createRoot(router, RootCmp);

        router.navigateByUrl('/first');
        tick();
        router.navigateByUrl('/second');
        tick();
        expect(router.url).toEqual('/second');

        location.historyGo(-1);
        tick();
        expect(router.url).toEqual('/first');

        location.historyGo(1);
        tick();
        expect(router.url).toEqual('/second');

        location.historyGo(-100);
        tick();
        expect(router.url).toEqual('/second');

        location.historyGo(100);
        tick();
        expect(router.url).toEqual('/second');

        location.historyGo(0);
        tick();
        expect(router.url).toEqual('/second');

        location.historyGo();
        tick();
        expect(router.url).toEqual('/second');
      }),
    ));

    it('should not error if state is not {[key: string]: any}', fakeAsync(
      inject([Router, Location], (router: Router, location: Location) => {
        router.resetConfig([
          {path: '', component: SimpleCmp},
          {path: 'simple', component: SimpleCmp},
        ]);

        const fixture = createRoot(router, RootCmp);
        let navigation: Navigation = null!;
        router.events.subscribe((e) => {
          if (e instanceof NavigationStart) {
            navigation = <Navigation>router.getCurrentNavigation()!;
          }
        });

        location.replaceState('', '', 42);
        router.navigateByUrl('/simple');
        tick();
        location.back();
        advance(fixture);

        // Angular does not support restoring state to the primitive.
        expect(navigation.extras.state).toEqual(undefined);
        expect(location.getState()).toEqual({navigationId: 3});
      }),
    ));

    it('should not pollute browser history when replaceUrl is set to true', fakeAsync(
      inject([Router, Location], (router: Router, location: Location) => {
        router.resetConfig([
          {path: '', component: SimpleCmp},
          {path: 'a', component: SimpleCmp},
          {path: 'b', component: SimpleCmp},
        ]);

        createRoot(router, RootCmp);

        const replaceSpy = spyOn(location, 'replaceState');
        router.navigateByUrl('/a', {replaceUrl: true});
        router.navigateByUrl('/b', {replaceUrl: true});
        tick();

        expect(replaceSpy.calls.count()).toEqual(1);
      }),
    ));

    it('should skip navigation if another navigation is already scheduled', fakeAsync(
      inject([Router, Location], (router: Router, location: Location) => {
        router.resetConfig([
          {path: '', component: SimpleCmp},
          {path: 'a', component: SimpleCmp},
          {path: 'b', component: SimpleCmp},
        ]);

        const fixture = createRoot(router, RootCmp);

        router.navigate(['/a'], {
          queryParams: {a: true},
          queryParamsHandling: 'merge',
          replaceUrl: true,
        });
        router.navigate(['/b'], {
          queryParams: {b: true},
          queryParamsHandling: 'merge',
          replaceUrl: true,
        });
        tick();

        /**
         * Why do we have '/b?b=true' and not '/b?a=true&b=true'?
         *
         * This is because the router has the right to stop a navigation mid-flight if another
         * navigation has been already scheduled. This is why we can use a top-level guard
         * to perform redirects. Calling `navigate` in such a guard will stop the navigation, and
         * the components won't be instantiated.
         *
         * This is a fundamental property of the router: it only cares about its latest state.
         *
         * This means that components should only map params to something else, not reduce them.
         * In other words, the following component is asking for trouble:
         *
         * ```
         * class MyComponent {
         *  constructor(a: ActivatedRoute) {
         *    a.params.scan(...)
         *  }
         * }
         * ```
         *
         * This also means "queryParamsHandling: 'merge'" should only be used to merge with
         * long-living query parameters (e.g., debug).
         */
        expect(router.url).toEqual('/b?b=true');
      }),
    ));
  });

  describe('should execute navigations serially', () => {
    let log: Array<string | Params> = [];

    beforeEach(() => {
      log = [];

      TestBed.configureTestingModule({
        providers: [
          {
            provide: 'trueRightAway',
            useValue: () => {
              log.push('trueRightAway');
              return true;
            },
          },
          {
            provide: 'trueIn2Seconds',
            useValue: () => {
              log.push('trueIn2Seconds-start');
              let res: (value: boolean) => void;
              const p = new Promise<boolean>((r) => (res = r));
              setTimeout(() => {
                log.push('trueIn2Seconds-end');
                res(true);
              }, 2000);
              return p;
            },
          },
        ],
      });
    });

    describe('route activation', () => {
      @Component({
        template: '<router-outlet></router-outlet>',
        standalone: false,
      })
      class Parent {
        constructor(route: ActivatedRoute) {
          route.params.subscribe((s: Params) => {
            log.push(s);
          });
        }
      }

      @Component({
        template: `
         <router-outlet (deactivate)="logDeactivate('primary')"></router-outlet>
         <router-outlet name="first" (deactivate)="logDeactivate('first')"></router-outlet>
         <router-outlet name="second" (deactivate)="logDeactivate('second')"></router-outlet>
         `,
        standalone: false,
      })
      class NamedOutletHost {
        logDeactivate(route: string) {
          log.push(route + ' deactivate');
        }
      }

      @Component({
        template: 'child1',
        standalone: false,
      })
      class Child1 {
        constructor() {
          log.push('child1 constructor');
        }
        ngOnDestroy() {
          log.push('child1 destroy');
        }
      }

      @Component({
        template: 'child2',
        standalone: false,
      })
      class Child2 {
        constructor() {
          log.push('child2 constructor');
        }
        ngOnDestroy() {
          log.push('child2 destroy');
        }
      }

      @Component({
        template: 'child3',
        standalone: false,
      })
      class Child3 {
        constructor() {
          log.push('child3 constructor');
        }
        ngOnDestroy() {
          log.push('child3 destroy');
        }
      }

      @NgModule({
        declarations: [Parent, NamedOutletHost, Child1, Child2, Child3],
        imports: [RouterModule.forRoot([])],
      })
      class TestModule {}

      it('should advance the parent route after deactivating its children', fakeAsync(() => {
        TestBed.configureTestingModule({imports: [TestModule]});
        const router = TestBed.inject(Router);
        const location = TestBed.inject(Location);
        const fixture = createRoot(router, RootCmp);

        router.resetConfig([
          {
            path: 'parent/:id',
            component: Parent,
            children: [
              {path: 'child1', component: Child1},
              {path: 'child2', component: Child2},
            ],
          },
        ]);

        router.navigateByUrl('/parent/1/child1');
        advance(fixture);

        router.navigateByUrl('/parent/2/child2');
        advance(fixture);

        expect(location.path()).toEqual('/parent/2/child2');
        expect(log).toEqual([
          {id: '1'},
          'child1 constructor',
          'child1 destroy',
          {id: '2'},
          'child2 constructor',
        ]);
      }));

      it('should deactivate outlet children with componentless parent', fakeAsync(() => {
        TestBed.configureTestingModule({imports: [TestModule]});
        const router = TestBed.inject(Router);
        const fixture = createRoot(router, RootCmp);

        router.resetConfig([
          {
            path: 'named-outlets',
            component: NamedOutletHost,
            children: [
              {
                path: 'home',
                children: [
                  {path: '', component: Child1, outlet: 'first'},
                  {path: '', component: Child2, outlet: 'second'},
                  {path: 'primary', component: Child3},
                ],
              },
              {
                path: 'about',
                children: [
                  {path: '', component: Child1, outlet: 'first'},
                  {path: '', component: Child2, outlet: 'second'},
                ],
              },
            ],
          },
          {
            path: 'other',
            component: Parent,
          },
        ]);

        router.navigateByUrl('/named-outlets/home/primary');
        advance(fixture);
        expect(log).toEqual([
          'child3 constructor', // primary outlet always first
          'child1 constructor',
          'child2 constructor',
        ]);
        log.length = 0;

        router.navigateByUrl('/named-outlets/about');
        advance(fixture);
        expect(log).toEqual([
          'child3 destroy',
          'primary deactivate',
          'child1 destroy',
          'first deactivate',
          'child2 destroy',
          'second deactivate',
          'child1 constructor',
          'child2 constructor',
        ]);
        log.length = 0;

        router.navigateByUrl('/other');
        advance(fixture);
        expect(log).toEqual([
          'child1 destroy',
          'first deactivate',
          'child2 destroy',
          'second deactivate',
          // route param subscription from 'Parent' component
          {},
        ]);
      }));

      it('should work between aux outlets under two levels of empty path parents', fakeAsync(() => {
        TestBed.configureTestingModule({imports: [TestModule]});
        const router = TestBed.inject(Router);
        router.resetConfig([
          {
            path: '',
            children: [
              {
                path: '',
                component: NamedOutletHost,
                children: [
                  {path: 'one', component: Child1, outlet: 'first'},
                  {path: 'two', component: Child2, outlet: 'first'},
                ],
              },
            ],
          },
        ]);

        const fixture = createRoot(router, RootCmp);

        router.navigateByUrl('/(first:one)');
        advance(fixture);
        expect(log).toEqual(['child1 constructor']);

        log.length = 0;
        router.navigateByUrl('/(first:two)');
        advance(fixture);
        expect(log).toEqual(['child1 destroy', 'first deactivate', 'child2 constructor']);
      }));
    });

    it('should not wait for prior navigations to start a new navigation', fakeAsync(
      inject([Router, Location], (router: Router) => {
        const fixture = createRoot(router, RootCmp);

        router.resetConfig([
          {path: 'a', component: SimpleCmp, canActivate: ['trueRightAway', 'trueIn2Seconds']},
          {path: 'b', component: SimpleCmp, canActivate: ['trueRightAway', 'trueIn2Seconds']},
        ]);

        router.navigateByUrl('/a');
        tick(100);
        fixture.detectChanges();

        router.navigateByUrl('/b');
        tick(100); // 200
        fixture.detectChanges();

        expect(log).toEqual([
          'trueRightAway',
          'trueIn2Seconds-start',
          'trueRightAway',
          'trueIn2Seconds-start',
        ]);

        tick(2000); // 2200
        fixture.detectChanges();

        expect(log).toEqual([
          'trueRightAway',
          'trueIn2Seconds-start',
          'trueRightAway',
          'trueIn2Seconds-start',
          'trueIn2Seconds-end',
          'trueIn2Seconds-end',
        ]);
      }),
    ));
  });
}
