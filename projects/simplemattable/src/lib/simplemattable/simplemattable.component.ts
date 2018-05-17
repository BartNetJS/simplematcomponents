import {Component, DoCheck, EventEmitter, Input, OnChanges, OnInit, Output, SimpleChanges, ViewChild} from '@angular/core';
import {TableColumn} from '../model/table-column.model';
import {MatPaginator, MatSort, MatTable, MatTableDataSource} from '@angular/material';
import {Align} from '../model/align.model';
import {ButtonType} from '../model/button-type.model';
import {AbstractControl, FormBuilder} from '@angular/forms';
import {FormFieldType} from '../model/form-field-type.model';
import {DataStatus} from '../model/data-status.model';

@Component({
  selector: 'smc-simplemattable',
  templateUrl: './simplemattable.component.html',
  styleUrls: ['./simplemattable.component.css']
})
export class SimplemattableComponent<T, P extends keyof T> implements OnInit, DoCheck, OnChanges {

  @Input() data: T[] = [];
  @Input() columns: TableColumn<T, P>[] = [];
  @Input() filter: boolean = false;
  @Input() paginator: boolean = false;
  @Input() sorting: boolean = false;
  @Input() paginatorPageSize: number = 10;
  @Input() paginatorPageSizeOptions: number[] = [5, 10, 20];
  @Input() editable: boolean = false;
  @Input() addable: boolean = false;
  @Input() deletable: boolean = false;
  @Input() create: () => T;

  @Output() delete: EventEmitter<T> = new EventEmitter<T>();
  @Output() edit: EventEmitter<T> = new EventEmitter<T>();
  @Output() add: EventEmitter<T> = new EventEmitter<T>();


  @ViewChild(MatPaginator) matPaginator: MatPaginator;
  @ViewChild(MatSort) matSort: MatSort;
  @ViewChild(MatTable) matTable: MatTable<T>;

  displayedColumns = [];
  dataSource: MatTableDataSource<T>;
  currentlyAdding: boolean = false;
  private dataStatus: Map<T, DataStatus> = new Map<T, DataStatus>(); // to know whether or not a row is being edited
  private oldColumns: TableColumn<T, P>[] = []; // For dirty-checking
  // There may only be one form control per cell
  // FormControls are identified by <rowIndex>_<colIndex>
  formControls: Map<string, AbstractControl> = new Map<string, AbstractControl>();

  buttonType = ButtonType;
  formFieldType = FormFieldType;


  constructor(private fb: FormBuilder) {
  }

  ngOnInit(): void {
    if (this.addable && !this.create) {
      throw Error('Seems like you enabled adding of elements (adding was set to true), but you did not supply a create function.' +
        ' Please specify a create function that will be used to create new Elements of your' +
        ' Model by binding to the create input parameter.');
    }
  }

  /**
   * Sets DataSource filter using the search string from the search input field.
   *
   * @param filterValue
   */
  applyFilter(filterValue: string) {
    filterValue = filterValue.trim(); // Remove whitespace
    filterValue = filterValue.toLowerCase(); // MatTableDataSource defaults to lowercase matches
    this.dataSource.filter = filterValue;
  }

  /**
   * Method used when a cell or a button is clicked.
   * Executes the onClick function of the TableColumn.
   *
   * @param tcol Clicked Column
   * @param element Clicked element
   * @param fromButton true = button; false = cell
   */
  onClick(tcol: TableColumn<T, P>, element: T, fromButton: boolean) {
    if (fromButton ? this.isButtonClickable(tcol) : this.isCellClickable(tcol, element)) {
      tcol.onClick(element[tcol.property], element);
    }
  }

  /**
   * Uses the TableColumn ngClass property to create the ngStyle Object for a table cell.
   * May also include some internal css classes.
   *
   * @param tcol TableColumn
   * @param element the element
   * @returns ngClass Object
   */
  getCellCssClass(tcol: TableColumn<T, P>, element: T): Object {
    const defaultClass = {'on-click': (tcol.onClick && !tcol.button)};
    if (!tcol.ngClass) {
      return defaultClass;
    }
    const ngClass = tcol.ngClass(element[tcol.property], element);
    if (!ngClass) {
      return defaultClass;
    }
    if (typeof ngClass === 'string') {
      return Object.assign(defaultClass, this.arrayToObject(ngClass.split(' ')));
    } else if (Array.isArray(ngClass)) {
      return Object.assign(defaultClass, this.arrayToObject(ngClass));
    } else {
      return Object.assign(defaultClass, ngClass);
    }
  }

  /**
   * Uses the TableColumn ngStyle property to create the ngStyle Object for a table cell.
   * May also include some internal css properties.
   *
   * @param tcol
   * @param element
   * @returns ngStyleObject
   */
  getCellCssStyle(tcol: TableColumn<T, P>, element: T): Object {
    const defaultStyle = {'justify-content': this.getAlign(tcol.align), 'display': 'flex'};
    return tcol.ngStyle ? Object.assign(defaultStyle, tcol.ngStyle(element[tcol.property], element)) : defaultStyle;
  }

  /**
   * Returns the form control for a string. If not currently present, it will create a new FormControl.
   *
   * @param colIndex
   * @param rowIndex
   * @param tcol tcol, used to set the initial value if creation of a new control is necessary
   * @param element Element, used to set the initial value if creation of a new control is necessary
   * @returns AbstractFormControl
   */
  getFormControl(rowIndex: number, colIndex: number, tcol: TableColumn<T, P>, element: T): AbstractControl {
    const id = rowIndex + '_' + colIndex;
    if (this.formControls.has(id)) {
      return this.formControls.get(id);
    } else {
      const control = this.fb.control(tcol.formField.init ? tcol.formField.init(element[tcol.property], element) : element[tcol.property]);
      this.formControls.set(id, control);
      return control;
    }
  }


  /*

      Next up are some simpler methods.
      Their name should suffice to understand their purpose,
      so I do not feel the necessity to write any JSDoc for them.

   */

  startAddElement() {
    const ele: T = this.create();
    this.data.unshift(ele);
    this.recreateDataSource();
    this.cleanUpAfterDataChange(false);
    const status = new DataStatus();
    status.added = true;
    status.editing = true;
    this.dataStatus.set(ele, status);
    this.currentlyAdding = true;
  }

  saveElement(rowIndex, oldElement: T) {
    // The id of a FormControl is <rowIndex>_<columnIndex>
    // so we can check if the id starts with the index to find all controls of that row
    const controls: { col: number, control: AbstractControl }[] = this.iteratorToArray(this.formControls.entries())
      .filter((entry) => entry[0].startsWith(rowIndex.toString()))
      .map(entry => ({col: +(entry[0].split('_')[1]), control: entry[1]})); // need col index for later
    if (controls.some(control => !control.control.valid)) {
      return;
    }
    const element = this.deepCopy(oldElement); // Deep copy old object to not override table values
    controls.forEach(control => {
      const tcol: TableColumn<T, P> = this.getDisplayedCols(this.columns)[control.col];
      const val = control.control.value;
      element[tcol.property] = tcol.formField.apply ? tcol.formField.apply(val, element[tcol.property], element) : val;
    });
    if (this.dataStatus.get(oldElement).added) {
      this.currentlyAdding = false;
      this.data.shift();
      console.log(this.data);
      this.add.emit(element);
    } else {
      this.edit.emit(element);
    }

  }

  startEditElement(element: T) {
    const status = this.dataStatus.has(element) ? this.dataStatus.get(element) : new DataStatus();
    status.editing = true;
    this.dataStatus.set(element, status);
  }

  cancelEditElement(element: T) {
    this.dataStatus.get(element).editing = false;
  }

  getStringRepresentation(tcol: TableColumn<T, P>, element: T): string {
    return tcol.transform ? tcol.transform(element[tcol.property], element) : element[tcol.property].toString();
  }

  private isButtonClickable = (tcol: TableColumn<T, P>) => tcol.onClick && tcol.button;
  private isCellClickable = (tcol: TableColumn<T, P>, element: T) => tcol.onClick && !tcol.button && !this.isEditing(element);

  isEditing = (element: T): boolean => this.dataStatus.get(element).editing;
  isEditingColumn = (tcol: TableColumn<T, P>, element: T): boolean => tcol.formField && this.isEditing(element);
  getIconName = (tcol: TableColumn<T, P>, element: T) => tcol.icon(element[tcol.property], element);
  getDisplayedCols = (cols: TableColumn<T, P>[]): TableColumn<T, P>[] => cols.filter(col => col.visible);
  getFxFlex = (tcol: TableColumn<T, P>): string => tcol.width ? tcol.width : '1 1 0px';
  getAlign = (align: Align): string => align === Align.LEFT ? 'flex-start' : align === Align.CENTER ? 'center' : 'flex-end';
  getTextAlign = (align: Align): string => align === Align.LEFT ? 'start' : align === Align.CENTER ? 'center' : 'end';
  isCenterAlign = (tcol: TableColumn<T, P>): boolean => tcol.align === Align.CENTER;

  arrayToObject(arr: string[]): Object { // turn ['css-class-a', 'css-class-b'] into {'css-class-a': true, 'css-class-b': true}
    return arr.reduce((acc, entry) => {
      acc[entry] = true;
      return acc;
    }, {});
  }

  iteratorToArray<Z>(iterator: IterableIterator<Z>): Z[] {
    const arr: Z[] = [];
    let res = iterator.next();
    while (!res.done) {
      arr.push(res.value);
      res = iterator.next();
    }
    return arr;
  }

  deepCopy(obj) {
    if (obj === null || typeof obj !== 'object') {
      return obj;
    }
    if (obj instanceof Date) {
      return new Date(obj.getTime());
    }
    if (Array.isArray(obj)) {
      return obj.map(ele => ele);
    }
    const clonedObj = new obj.constructor();
    for (const prop in obj) {
      if (obj.hasOwnProperty(prop)) {
        clonedObj[prop] = this.deepCopy(obj[prop]);
      }
    }
    return clonedObj;
  }

  /* -----------------------

      DIRTY CHECKING AND DATASOURCE REBUILDING
      It works like this:
      - Check for Changes in Data (ngOnChanges) or Columns (ngDoCheck)
      - If changes are found, recreate the DataSource,
          which includes reassigning the paginator and the sorting function
      - Datachanges and columnchanges each require some extra work (cleanup)
          e.g. to reset the row status

     ----------------------- */

  // checks for data changes
  ngOnChanges(changes: SimpleChanges): void {
    if (changes.data) {
      this.clearAddedEntry();
      this.recreateDataSource();
      this.cleanUpAfterDataChange(!!changes.columns);
    }
  }

  private clearAddedEntry() {
    let toDelete: T;
    this.dataStatus.forEach((value: DataStatus, key: T) => {
      if (value.added) {
        toDelete = key;
        this.data.splice(this.data.indexOf(key), 1);
      }
    });
    if (toDelete) {
      this.dataStatus.delete(toDelete);
    }
  }

  private cleanUpAfterDataChange(columnChanges: boolean) {
    this.dataStatus.clear();
    this.data.forEach(data => this.dataStatus.set(data, new DataStatus()));
    this.formControls.clear();
    if (this.matSort.active) {
      if (columnChanges) { // If columns are changed, resorting might cause bugs
        this.turnOffSorting();
      } else {
        this.dataSource.data = this.dataSource.sortData(this.dataSource.data, this.matSort);
      }
    }
    this.currentlyAdding = false;
  }

  // checks for column changes
  ngDoCheck(): void {
    if (this.checkForDifferences()) {
      this.prepareForColChange();
      this.recreateDataSource();
      this.cleanUpAfterColChange();
    }
  }

  private prepareForColChange() {
    this.clearAddedEntry();
    this.turnOffSorting();
  }

  private cleanUpAfterColChange() {
    this.dataStatus.forEach((value: DataStatus, key: T) => {
      this.dataStatus.set(key, new DataStatus());
    });
    this.formControls.clear();
    this.oldColumns = this.columns.map(col => Object.assign({}, col)); // copy cols to lose references
    this.currentlyAdding = false;
  }

  private turnOffSorting() {
    if (this.matSort.active) {
      this.matSort.direction = '';
      this.matSort.active = '';
    }
  }

  // only checks for column differences
  private checkForDifferences(): boolean {
    if (this.oldColumns.length !== this.columns.length) {
      return true;
    }
    return this.oldColumns.some((col, i) => {
      for (const key in col) {
        if (col[key] !== this.columns[i][key]) {
          return true;
        }
      }
    });
  }

  private recreateDataSource() {
    if (this.columns && this.data) {
      this.dataSource = new MatTableDataSource(this.data);
      this.dataSource.filterPredicate = (data: T, filter: string) =>
        this.columns.reduce((str, col) => str + this.getStringRepresentation(col, data).toLowerCase().trim(), '')
          .indexOf(filter.toLowerCase().trim()) >= 0;

      if (this.paginator) {
        this.dataSource.paginator = this.matPaginator;
      }
      if (this.sorting) {
        // Closure for visible cols possible since column change will always also provoke a dataSource rebuild
        const visibleCols = this.columns.filter(col => col.visible);
        this.dataSource.sort = this.matSort;
        this.dataSource.sortingDataAccessor = (data, sortHeaderId) => {
          /*  Sort string determination order:
              1. SortTransform
              2. Date --> ISO-String
              3. Transform (if object)
              4. Property value
           */
          const tcol = visibleCols[sortHeaderId.split('_')[0]];
          if (!tcol) { // May happen if sorting collides with new DataSource creation
            return ''; // If that happens, multiple runs will be performed, so we will be ok with just returning empty string in this run
          }
          if (tcol.sortTransform) {
            return tcol.sortTransform(data[tcol.property], data);
          }
          if (data[tcol.property] instanceof Date) {
            return data[tcol.property].toISOString();
          }
          // Cant sort if data is object of a format i do not know since toString will be [object Object].
          // Therefore, try to use transform if possible
          if (tcol.transform && typeof data[tcol.property] === 'object') {
            return tcol.transform(data[tcol.property]);
          }
          return data[tcol.property];
        };
      }
      this.displayedColumns = this.getDisplayedCols(this.columns).map((col, i) => i.toString() + '_' + col.property);
      if (this.editable || this.addable || this.deletable) {
        this.displayedColumns.push('actions');
      }
    }
  }

}
