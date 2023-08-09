import {
  FieldValues,
  Resolver,
  FieldErrors,
  FieldErrorsImpl,
  DeepRequired,
  GlobalError,
  FieldError,
} from "react-hook-form";

/**
 * Generates an output object from the given form data, where the keys in the output object retain
 * the structure of the keys in the form data. Keys containing integer indexes are treated as arrays.
 *
 * @param {FormData} formData - The form data to generate an output object from.
 * @returns {Object} The output object generated from the form data.
 */
export const generateFormData = (formData: FormData) => {
  // Initialize an empty output object.
  const outputObject: Record<any, any> = {};

  // Iterate through each key-value pair in the form data.
  for (const [key, value] of formData.entries()) {
    // Split the key into an array of parts.
    const keyParts = key.split(".");
    // Initialize a variable to point to the current object in the output object.
    let currentObject = outputObject;

    // Iterate through each key part except for the last one.
    for (let i = 0; i < keyParts.length - 1; i++) {
      // Get the current key part.
      const keyPart = keyParts[i];
      // If the current object doesn't have a property with the current key part,
      // initialize it as an object or array depending on whether the next key part is a valid integer index or not.
      if (!currentObject[keyPart]) {
        currentObject[keyPart] = /^\d+$/.test(keyParts[i + 1]) ? [] : {};
      }
      // Move the current object pointer to the next level of the output object.
      currentObject = currentObject[keyPart];
    }

    // Get the last key part.
    const lastKeyPart = keyParts[keyParts.length - 1];
    const lastKeyPartIsArray = /\[\d*\]$|\[\]$/.test(lastKeyPart);

    // Handles array[] or array[0] cases
    if (lastKeyPartIsArray) {
      const key = lastKeyPart.replace(/\[\d*\]$|\[\]$/, "");
      if (!currentObject[key]) {
        currentObject[key] = [];
      }
      currentObject[key].push(value);
    }

    // Handles array.foo.0 cases
    if (!lastKeyPartIsArray) {
      // If the last key part is a valid integer index, push the value to the current array.
      if (/^\d+$/.test(lastKeyPart)) {
        currentObject.push(value);
      }
      // Otherwise, set a property on the current object with the last key part and the corresponding value.
      else {
        currentObject[lastKeyPart] = value;
      }
    }
  }

  // Return the output object.
  return outputObject;
};

export const getFormDataFromSearchParams = (request: Pick<Request, "url">) => {
  const searchParams = new URL(request.url).searchParams as unknown as FormData;
  return generateFormData(searchParams);
};

export const isGet = (request: Pick<Request, "method">) =>
  request.method === "GET" || request.method === "get";

/**
 * Parses the data from an HTTP request and validates it against a schema. Works in both loaders and actions, in loaders it extracts the data from the search params.
 * In actions it extracts it from request formData.
 *
 * @async
 * @param {Request} request - An object that represents an HTTP request.
 * @param validator - A function that resolves the schema.
 * @returns A Promise that resolves to an object containing the validated data or any errors that occurred during validation.
 */
export const getValidatedFormData = async <T extends FieldValues>(
  request: Request,
  resolver: Resolver
) => {
  const data = isGet(request)
    ? getFormDataFromSearchParams(request)
    : await parseFormData<T>(request);
  const validatedOutput = await validateFormData<T>(data, resolver);
  return { ...validatedOutput, receivedValues: data };
};

/**
 * Helper method used in actions to validate the form data parsed from the frontend using zod and return a json error if validation fails.
 * @param data Data to validate
 * @param resolver Schema to validate and cast the data with
 * @returns Returns the validated data if successful, otherwise returns the error object
 */
export const validateFormData = async <T extends FieldValues>(
  data: any,
  resolver: Resolver
) => {
  const { errors, values } = await resolver(
    data,
    {},
    { shouldUseNativeValidation: false, fields: {} }
  );

  if (Object.keys(errors).length > 0) {
    return { errors: errors as FieldErrors<T>, data: undefined };
  }

  return { errors: undefined, data: values as T };
};
/**
  Creates a new instance of FormData with the specified data and key.
  @template T - The type of the data parameter. It can be any type of FieldValues.
  @param {T} data - The data to be added to the FormData. It can be either an object of type FieldValues.
  @param {string} [key="formData"] - The key to be used for adding the data to the FormData.
  @returns {FormData} - The FormData object with the data added to it.
*/
export const createFormData = <T extends FieldValues>(
  data: T,
  key: string = "formData"
): FormData => {
  const formData = new FormData();
  const finalData = JSON.stringify(data);
  formData.append(key, finalData);
  return formData;
};
/**
Parses the specified Request object's FormData to retrieve the data associated with the specified key.
@template T - The type of the data to be returned.
@param {Request} request - The Request object whose FormData is to be parsed.
@param {string} [key="formData"] - The key of the data to be retrieved from the FormData.
@returns {Promise<T>} - A promise that resolves to the data of type T.
@throws {Error} - If no data is found for the specified key, or if the retrieved data is not a string.
*/
export const parseFormData = async <T extends any>(
  request: Request,
  key: string = "formData"
): Promise<T> => {
  const formData = await request.formData();
  const data = formData.get(key);

  if (!data) {
    return generateFormData(formData);
  }

  if (!(typeof data === "string")) {
    throw new Error("Data is not a string");
  }

  return JSON.parse(data);
};

/**
Merges two error objects generated by a resolver, where T is the generic type of the object.
The function recursively merges the objects and returns the resulting object.
@template T - The generic type of the object.
@param frontendErrors - The frontend errors
@param backendErrors - The backend data that may contain errors
@returns The merged errors of type FieldErrors<T>.
*/
export const mergeErrors = <T extends FieldValues>(
  frontendErrors: FieldErrors<T>,
  backendErrors?: unknown,
  onMerge: () => void = () => {}
) => {
  if (!backendErrors) {
    return frontendErrors;
  }

  for (const [key, rightValue] of Object.entries(backendErrors)) {
    if (
      typeof rightValue === "object" &&
      !Array.isArray(rightValue) &&
      !rightValue?.message
    ) {
      mergeErrors(frontendErrors, parseRightValue<T>(key, rightValue));
    } else if (rightValue?.message) {
      frontendErrors[key as keyof T] = { type: "custom", ...rightValue };
    } else if (typeof rightValue === "string") {
      frontendErrors[key as keyof T] = {
        message: rightValue,
        type: "custom",
      } as NonNullable<NonNullable<DeepRequired<T>[keyof T]>>;
    }
  }

  onMerge();

  return frontendErrors;
};

/**
Parses the right value to see if it is a react-hook-form root serverError or random error.
@template T - The generic type of the object.
@param key - keyof T
@param rightValue - right value of the data returned from useActionData
@returns Field Errors or a data object
*/
const parseRightValue = <T extends FieldValues>(
  key: keyof T,
  rightValue: Partial<FieldErrorsImpl<DeepRequired<T>>>
) => {
  let value = rightValue;
  if (key === "root") {
    if (rightValue["serverError" as keyof T]) {
      value = {
        "root.serverError": {
          type: "400",
          ...rightValue["serverError" as keyof T],
        },
      } as Partial<FieldErrorsImpl<DeepRequired<T>>>;
    }
    if (rightValue["random" as keyof T]) {
      value = {
        "root.random": {
          type: "random",
          ...rightValue["random" as keyof T],
        },
      } as Partial<FieldErrorsImpl<DeepRequired<T>>>;
    }
  }
  return value;
};
